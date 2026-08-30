/**
 * Input token pruning — reduce what the LLM receives.
 *
 * Two stages, with very different risk profiles.
 *
 * At source (`tool_result`): oversized output is reduced structurally rather
 * than cut at a byte offset, and the original is written to the artifact store
 * first. A code file keeps its declaration skeleton, a log keeps both ends with
 * its repeats folded, a listing keeps whole entries. Nothing is destroyed.
 *
 * Before each call (`context`): results made redundant by later work are
 * collapsed unconditionally, and stale results are stubbed only once context
 * pressure crosses the high-water mark. Below that mark this stage does nothing
 * lossy at all, which is the cheapest way there is to avoid losing fidelity.
 *
 * Both stages leave a `thrift_recall` ref in the text they replace, so every
 * elision is reversible by the model on demand.
 */

import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import type {
  ExtensionAPI,
  ExtensionContext,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import { formatSize, truncateHead, truncateTail } from "@earendil-works/pi-coding-agent";
import { type Artifact, type ArtifactStore, registerRecallTool } from "./artifacts.js";
import type { ThriftConfig } from "./config.js";
import {
  type Decision,
  type PlanMessage,
  type PruningReason,
  type PruningState,
  planPruning,
  renderStub,
  type ToolCallInfo,
} from "./policy.js";
import { reduceToolOutput } from "./reducers.js";

// ── Public stats (read by index.ts for /thrift stats) ───────────────────

export interface InputStats {
  /** Bytes removed at source across the session. */
  sourceBytesSaved: number;
  sourceResultsReduced: number;
  /** Bytes not sent on the most recent LLM call. */
  lastContextBytesSaved: number;
  lastContextStubbed: number;
  lastContextSuperseded: number;
  /** Results the planner chose to elide but that were kept anyway, because
   *  they could not be spilled and an unrecoverable stub is worse than the
   *  tokens. */
  lastContextHeldBack: number;
  /** Why the planner did what it did, for `/thrift stats`. */
  lastReason: PruningReason | "idle";
  /** True when the last decision ran on a self-measured estimate because the
   *  host reports no context usage. */
  lastEstimated: boolean;
  /** Context fill at the last call, as a percentage. */
  lastPercent: number | null;
  /** Last compaction event metadata (for /thrift stats). */
  lastCompactionReason: "manual" | "threshold" | "overflow" | null;
  lastCompactionTokensBefore: number | null;
  lastCompactionUsageTokens: number | null;
  state: PruningState;
  store: ArtifactStore;
}

// ── Helpers ─────────────────────────────────────────────────────────────

interface TextBlock {
  type: string;
  text?: string;
}

function contentBlocks(content: unknown): TextBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];
  return content as TextBlock[];
}

function textOf(content: unknown): string {
  const blocks = contentBlocks(content);
  const idx = blocks.findIndex((c) => c.type === "text");
  if (idx === -1) return "";
  return blocks[idx]?.text ?? "";
}

export const byteLen = (s: string): number => Buffer.byteLength(s, "utf-8");

/** Rough size of the recall notice appended to reduced text. */
const NOTICE_BYTES = 128;

/**
 * Index tool-call arguments by call id.
 *
 * Arguments live on the assistant message that requested the call, never on the
 * result, so anything that wants to describe a result — a dedupe key, a
 * staleness check, an artifact label — has to walk back for them. Both the
 * `context` hook and compaction prep need this, and compaction is entitled to
 * rely on it: pi never cuts a span between a tool call and its result, so a
 * result whose request is absent here is one that genuinely had none.
 */
export function collectToolCalls(messages: readonly unknown[]): Map<string, ToolCallInfo> {
  const calls = new Map<string, ToolCallInfo>();

  for (const message of messages) {
    const msg = message as { role?: string; content?: unknown };
    if (msg?.role !== "assistant" || !Array.isArray(msg.content)) continue;

    for (const part of msg.content as Array<Record<string, unknown>>) {
      if (part.type !== "toolCall") continue;
      const id = part.id;
      const name = part.name;
      if (typeof id !== "string" || typeof name !== "string") continue;
      const args = part.arguments;
      calls.set(id, {
        name,
        arguments:
          typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {},
      });
    }
  }

  return calls;
}

/** Short human label for an artifact, e.g. `read src/input.ts`. */
export function describeCall(toolName: string, input: Record<string, unknown>): string {
  const detail =
    (typeof input.path === "string" && input.path) ||
    (typeof input.command === "string" && input.command) ||
    (typeof input.pattern === "string" && input.pattern) ||
    "";
  const trimmed = detail.length > 60 ? `${detail.slice(0, 57)}...` : detail;
  return trimmed === "" ? toolName : `${toolName} ${trimmed}`;
}

// ── Registration ────────────────────────────────────────────────────────

export function registerInputPruning(
  pi: ExtensionAPI,
  config: ThriftConfig,
  store: ArtifactStore,
): InputStats {
  const stats: InputStats = {
    sourceBytesSaved: 0,
    sourceResultsReduced: 0,
    lastContextBytesSaved: 0,
    lastContextStubbed: 0,
    lastContextSuperseded: 0,
    lastContextHeldBack: 0,
    lastReason: "idle",
    lastEstimated: false,
    lastPercent: null,
    lastCompactionReason: null,
    lastCompactionTokensBefore: null,
    lastCompactionUsageTokens: null,
    state: { decisions: new Map<string, Decision>(), engaged: false },
    store,
  };

  registerRecallTool(pi, store);

  // The artifact each tool call was spilled to, so stage 2 can point at what
  // stage 1 already stored instead of spilling a second, poorer copy.
  const spilled = new Map<string, Artifact>();

  // ────────────────────────────────────────────────────────────────────
  // Stage 1 — reduce oversized results at source.
  //
  // The reduced text is what gets stored in the session, so the saving is
  // permanent; the original is in the artifact store, so the loss is not.
  // ────────────────────────────────────────────────────────────────────

  pi.on("tool_result", async (event: ToolResultEvent, ctx) => {
    if (!config.enabled || !config.input.enabled) return;

    // Errors stay whole. They are small, and diagnostics are exactly the thing
    // worth spending context on.
    if (event.isError) return;

    const maxBytes = config.input.maxResultBytes[event.toolName];
    if (maxBytes === undefined) return;

    const blocks = contentBlocks(event.content);
    const textIdx = blocks.findIndex((c) => c.type === "text");
    if (textIdx === -1) return;
    const block = blocks[textIdx];
    if (block === undefined || block.type !== "text") return;

    const original = block.text ?? "";
    if (!original) return;
    const originalBytes = byteLen(original);

    // A read with an explicit window is the model narrowing its own request,
    // often in response to an earlier elision. Reducing that again fights the
    // model and corrupts the line numbering it just asked for, so leave it
    // alone until it is far past the threshold. pi's own 2000-line ceiling
    // still applies underneath, so this cannot run away.
    const windowed =
      event.toolName === "read" &&
      (event.input.offset !== undefined || event.input.limit !== undefined);
    const threshold = windowed ? maxBytes * 2 : maxBytes;
    if (originalBytes <= threshold) return;

    const path = typeof event.input.path === "string" ? event.input.path : undefined;

    let reducedText: string;
    if (config.input.reduce) {
      reducedText = reduceToolOutput(event.toolName, original, {
        path,
        maxEntries: config.input.maxListEntries,
      }).text;
    } else {
      const truncFn = event.toolName === "bash" ? truncateTail : truncateHead;
      reducedText = truncFn(original, { maxBytes, maxLines: config.input.maxResultLines }).content;
    }

    // Backstop: structural reduction can still leave a lot behind for a file
    // that is mostly declarations. Cap it, from whichever end the tool cares
    // about — the tail for commands, the head for everything else.
    if (reducedText.split("\n").length > config.input.maxResultLines) {
      const capFn = event.toolName === "bash" ? truncateTail : truncateHead;
      reducedText = capFn(reducedText, { maxLines: config.input.maxResultLines }).content;
    }

    // The recall notice ships with the reduced text, so a reduction that only
    // just beats the original would grow the message once annotated.
    const reducedBytes = byteLen(reducedText);
    if (reducedBytes + NOTICE_BYTES >= originalBytes) return;

    // Spill only once reduction is certain, and only proceed once it has
    // succeeded. Writing first orphans a file every time reduction is
    // abandoned; cutting first makes the loss permanent if the write fails.
    const label = describeCall(event.toolName, event.input);
    const artifact = await store.spill(event.toolName, label, original);
    if (artifact === undefined) return;

    spilled.set(event.toolCallId, artifact);

    const notice =
      `\n\n[thrift: reduced to ${formatSize(reducedBytes)} of ${formatSize(originalBytes)}` +
      ` (${artifact.lines} lines). Full output: thrift_recall(ref="${artifact.ref}").]`;

    const newText = reducedText + notice;
    stats.sourceBytesSaved += originalBytes - byteLen(newText);
    stats.sourceResultsReduced++;

    // Preserve non-text blocks (images and friends).
    const newContent: (TextContent | ImageContent)[] = blocks.map((b, idx) => {
      if (idx === textIdx) return { type: "text", text: newText };
      if (b.type === "image") return b as ImageContent;
      return { type: "text", text: b.text ?? "" };
    });

    if (config.showStatus) {
      ctx.ui.setStatus("thrift", `reduced ${formatSize(stats.sourceBytesSaved)}`);
    }

    return { content: newContent };
  });

  // ────────────────────────────────────────────────────────────────────
  // Stage 2 — elide redundant and stale results before each LLM call.
  //
  // The messages array is a deep copy, so edits here shape only this request;
  // the stored session keeps full fidelity and compaction still sees it all.
  // ────────────────────────────────────────────────────────────────────

  pi.on("context", async (event, ctx) => {
    if (!config.enabled || !config.input.enabled) return;

    const messages = event.messages as unknown as Array<{
      role: string;
      toolCallId?: string;
      toolName?: string;
      isError?: boolean;
      content?: TextBlock[];
    }>;

    // Dedupe keys and path staleness both depend on the arguments, so index
    // them before planning.
    const calls = collectToolCalls(messages);

    const pressure = readPressure(ctx);

    const plan = planPruning({
      messages: messages.map(
        (m): PlanMessage => ({
          role: m.role,
          toolCallId: m.toolCallId,
          toolName: m.toolName,
          isError: m.isError,
          bytes: byteLen(textOf(m.content)),
        }),
      ),
      calls,
      pressure,
      config: {
        keepRecentTurns: config.input.keepRecentTurns,
        stubThresholdBytes: config.input.stubThresholdBytes,
        lowWaterPercent: config.input.lowWaterPercent,
        highWaterPercent: config.input.highWaterPercent,
        minReclaimPercent: config.input.minReclaimPercent,
        assumedContextWindowTokens: config.input.assumedContextWindowTokens,
        prunableTools: new Set(Object.keys(config.input.maxResultBytes)),
      },
      state: config.input.monotonic
        ? stats.state
        : { decisions: new Map<string, Decision>(), engaged: stats.state.engaged },
    });

    stats.state = { decisions: plan.decisions, engaged: plan.engaged };
    stats.lastReason = plan.reason;
    stats.lastEstimated = plan.estimated;
    stats.lastPercent = plan.percent;

    let bytesSaved = 0;
    let stubbed = 0;
    let superseded = 0;
    let heldBack = 0;

    const pruned = await Promise.all(
      messages.map(async (msg) => {
        if (msg.role !== "toolResult") return msg;
        const { toolCallId, toolName } = msg;
        if (toolCallId === undefined || toolName === undefined) return msg;

        const decision = plan.decisions.get(toolCallId);
        if (decision === undefined || decision === "keep") return msg;

        const original = textOf(msg.content);
        const originalBytes = byteLen(original);
        if (originalBytes === 0) return msg;

        // Prefer the artifact stage 1 already wrote. Spilling the message text
        // again would store the reduced copy under a fresh ref, so recovering
        // the real output would take two hops the stub never mentions.
        const existing = spilled.get(toolCallId);
        const info = calls.get(toolCallId);
        const label = describeCall(toolName, info?.arguments ?? {});
        const artifact = existing ?? (await store.spill(toolName, label, original));

        // No artifact means the stub would be a dead end. Spending context is
        // the lesser failure, so leave the result whole and try again next call.
        if (artifact === undefined) {
          heldBack++;
          return msg;
        }
        spilled.set(toolCallId, artifact);

        const stub = renderStub(toolName, artifact.lines, decision, artifact.ref);

        bytesSaved += originalBytes - byteLen(stub);
        if (decision === "superseded") superseded++;
        else stubbed++;

        return { ...msg, content: [{ type: "text" as const, text: stub }] };
      }),
    );

    stats.lastContextBytesSaved = bytesSaved;
    stats.lastContextStubbed = stubbed;
    stats.lastContextSuperseded = superseded;
    stats.lastContextHeldBack = heldBack;

    updateStatus(ctx, config, stats);

    if (stubbed === 0 && superseded === 0) return;
    return { messages: pruned as unknown as typeof event.messages };
  });

  return stats;
}

// ── Context pressure ────────────────────────────────────────────────────

/**
 * Read the host's view of context usage.
 *
 * Returns null when the host exposes no usage API, which the planner treats as
 * a signal to fall back to the old recency rule. A null `tokens` inside a
 * present reading is different and means "not known right now" — usually just
 * after compaction — and the planner holds steady rather than guessing.
 */
function readPressure(
  ctx: ExtensionContext,
): { tokens: number | null; contextWindow: number } | null {
  const usage = ctx.getContextUsage?.();
  if (usage === undefined) return null;
  return { tokens: usage.tokens, contextWindow: usage.contextWindow };
}

function updateStatus(
  ctx: Pick<ExtensionContext, "ui">,
  config: ThriftConfig,
  stats: InputStats,
): void {
  if (!config.showStatus) {
    ctx.ui.setStatus("thrift", "");
    return;
  }

  const parts: string[] = [];
  if (stats.sourceBytesSaved > 0) parts.push(`reduced ${formatSize(stats.sourceBytesSaved)}`);
  if (stats.lastContextSuperseded > 0) parts.push(`${stats.lastContextSuperseded} superseded`);
  if (stats.lastContextStubbed > 0) parts.push(`${stats.lastContextStubbed} elided`);
  if (stats.lastPercent !== null) parts.push(`${Math.round(stats.lastPercent)}% ctx`);

  ctx.ui.setStatus("thrift", parts.join(", "));
}
