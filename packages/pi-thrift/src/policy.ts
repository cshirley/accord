/**
 * Pruning policy — what to drop, and when.
 *
 * The original policy was "stub every tool result older than three turns, on
 * every call, forever".  That has two faults.  It prunes just as hard at 5%
 * context as at 95%, destroying information when there is no pressure to
 * justify it; and recency is a poor proxy for relevance, so it keeps a stale
 * `ls` while discarding the `read` of the file being edited.
 *
 * This module replaces it with two passes:
 *
 *   1. Supersession — lossless, always on.  Identical repeated calls, and reads
 *      invalidated by a later write to the same path, collapse to a pointer at
 *      the surviving copy.  Nothing recoverable is lost, so pressure is
 *      irrelevant and this runs unconditionally.
 *
 *   2. Budgeted stubbing — lossy, pressure-gated.  Nothing is stubbed until
 *      context crosses a high-water mark; then oldest-first stubbing runs until
 *      the projection falls back to a low-water mark.  Below the low mark
 *      thrift does nothing at all, which is the cheapest possible way to avoid
 *      losing fidelity.
 *
 * Decisions are monotonic: once stubbed, a result is never un-stubbed. Provider
 * prompt caches match on prefixes, so a decision that flips back and forth
 * invalidates the cache twice and confuses the model about what it has seen.
 * Hysteresis between the two marks means the frontier advances in occasional
 * batches rather than nibbling every turn, so each cache invalidation buys a
 * large reclaim instead of a trivial one.
 *
 * Pure and dependency-free so the policy can be tested without a live session.
 */

/** Rough bytes-per-token, matching pi's own chars/4 estimator. */
const BYTES_PER_TOKEN = 4;

export type Decision = "keep" | "stub" | "superseded";

/** Minimal projection of a conversation message. Keeping this narrow is what
 *  lets the planner run against fixtures instead of a real session. */
export interface PlanMessage {
  role: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  /** Size of the message's text content. */
  bytes: number;
}

export interface ToolCallInfo {
  name: string;
  arguments: Record<string, unknown>;
}

export interface PruningConfig {
  /** Never stub tool results inside this many trailing turns, at any pressure. */
  keepRecentTurns: number;
  /** Results below this size are not worth a stub. */
  stubThresholdBytes: number;
  /** Context percentage below which nothing lossy happens. */
  lowWaterPercent: number;
  /** Context percentage at which stubbing engages. */
  highWaterPercent: number;
  /** Do not engage unless at least this much of the window can be reclaimed,
   *  so a cache invalidation is never spent on a trivial gain. */
  minReclaimPercent: number;
  /** Window size assumed when the host reports no usage at all, so the same
   *  watermarks can run against a self-measured estimate. */
  assumedContextWindowTokens: number;
  prunableTools: ReadonlySet<string>;
}

export interface PruningState {
  decisions: Map<string, Decision>;
  /** Hysteresis latch: true between crossing the high mark and falling back
   *  under the low mark. */
  engaged: boolean;
}

export interface ContextPressure {
  /** Null when pi cannot estimate yet, e.g. immediately after compaction. */
  tokens: number | null;
  contextWindow: number;
}

export interface PruningInput {
  messages: readonly PlanMessage[];
  /** toolCallId to the call that produced it, for dedupe keys and path tracking. */
  calls: ReadonlyMap<string, ToolCallInfo>;
  /** Null when the host exposes no usage API at all. */
  pressure: ContextPressure | null;
  config: PruningConfig;
  state: PruningState;
}

export type PruningReason =
  | "disabled-no-history"
  | "supersede-only"
  | "below-low-water"
  | "usage-unknown"
  | "engaged"
  | "reclaim-too-small";

export interface PruningPlan {
  decisions: Map<string, Decision>;
  engaged: boolean;
  stubbed: number;
  superseded: number;
  reclaimedBytes: number;
  reason: PruningReason;
  /** Context fill the decision was made against, or null when it could not be
   *  determined at all. */
  percent: number | null;
  /** True when the host reported no usage and pressure was measured from the
   *  conversation instead. The decisions are the same shape either way; this
   *  says how much to trust them. */
  estimated: boolean;
}

// ── Keys and paths ──────────────────────────────────────────────────────

/** Stable identity for a tool call: same tool, same arguments, same key.
 *  Object keys are sorted so argument ordering cannot defeat the match. */
export function dedupeKey(name: string, args: Record<string, unknown>): string {
  const sorted = Object.keys(args)
    .sort()
    .map((k) => `${k}=${JSON.stringify(args[k])}`)
    .join(",");
  return `${name}(${sorted})`;
}

const PATH_ARG_KEYS = ["path", "file", "filePath", "file_path"];

/** Best-effort extraction of the file a call targets, for staleness tracking. */
export function callPath(info: ToolCallInfo): string | undefined {
  for (const key of PATH_ARG_KEYS) {
    const value = info.arguments[key];
    if (typeof value === "string" && value !== "") return value;
  }
  return undefined;
}

const MUTATING_TOOLS = new Set([
  "edit",
  "write",
  "create",
  "multi_edit",
  "apply_patch",
  "notebook_edit",
  "str_replace",
]);

/**
 * Tools whose output is a snapshot of state, so a later identical call fully
 * replaces an earlier one.
 *
 * `bash` is deliberately absent. Running the same command twice is usually a
 * before-and-after comparison — a test suite re-run, a `git status` after a
 * change — and there the earlier output is the half carrying the information.
 */
const SNAPSHOT_TOOLS = new Set(["read", "ls", "find", "grep"]);

/** Shell verbs that rewrite files somewhere in their arguments. */
const MUTATING_VERB =
  /(?:^|[\s;&|])(?:rm|mv|cp|tee|truncate|patch|dd|install)\s|sed\s+-i|git\s+(?:checkout|restore|apply|stash|clean)\s/;

/** Redirection targets, which name the written file directly. */
const REDIRECT_TARGET = /(?:^|\s)>>?\s*("[^"]+"|'[^']+'|\S+)/g;

/**
 * Best-effort guess at which tracked files a shell command rewrites.
 *
 * A command's real effects are not knowable from its text, so this errs toward
 * naming a file: a wrongly superseded read costs one `thrift_recall`, while a
 * missed mutation leaves the model reasoning about a file that has changed
 * underneath it. Redirections are matched on their target alone — `grep x a.ts
 * > /dev/null` rewrites `/dev/null`, not `a.ts` — while the destructive verbs
 * match any tracked path in the command, since their argument shapes vary too
 * much to parse.
 */
export function bashMutatedPaths(command: string, tracked: ReadonlySet<string>): string[] {
  const out = new Set<string>();

  for (const match of command.matchAll(REDIRECT_TARGET)) {
    const target = (match[1] ?? "").replace(/^["']|["']$/g, "");
    for (const path of tracked) {
      if (target === path || target.endsWith(`/${path}`) || path.endsWith(`/${target}`)) {
        out.add(path);
      }
    }
  }

  if (MUTATING_VERB.test(command)) {
    for (const path of tracked) {
      if (command.includes(path)) out.add(path);
    }
  }

  return [...out];
}

// ── Turn boundaries ─────────────────────────────────────────────────────

/**
 * Index of the message starting the protected trailing window.
 *
 * Walks back from the newest message counting user turns. Everything from this
 * index onward is off-limits regardless of pressure — the model needs its
 * current working set intact. Returns 0 when there is not enough history,
 * which protects the whole conversation.
 */
export function protectedFrom(messages: readonly PlanMessage[], keepRecentTurns: number): number {
  if (keepRecentTurns <= 0) return messages.length;

  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]?.role !== "user") continue;
    seen++;
    if (seen >= keepRecentTurns) return i;
  }
  return 0;
}

// ── Planner ─────────────────────────────────────────────────────────────

interface Candidate {
  index: number;
  toolCallId: string;
  toolName: string;
  bytes: number;
  key: string;
  path: string | undefined;
}

function collectCandidates(input: PruningInput): Candidate[] {
  const { messages, calls, config } = input;
  const out: Candidate[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg === undefined) continue;
    if (msg.role !== "toolResult") continue;
    if (msg.isError === true) continue;

    const { toolCallId, toolName } = msg;
    if (toolCallId === undefined || toolName === undefined) continue;
    if (!config.prunableTools.has(toolName)) continue;
    if (msg.bytes < config.stubThresholdBytes) continue;

    const info = calls.get(toolCallId);
    out.push({
      index: i,
      toolCallId,
      toolName,
      bytes: msg.bytes,
      key: info === undefined ? `${toolName}#${toolCallId}` : dedupeKey(info.name, info.arguments),
      path: info === undefined ? undefined : callPath(info),
    });
  }

  return out;
}

/**
 * Mark results made redundant by later activity.
 *
 * Two rules. An identical inspection call repeated later supersedes its earlier
 * copies: the newer output describes the same thing at a later moment, so the
 * older one is at best a duplicate and at worst a stale claim about the present.
 * And a read is superseded by any later write to the same path, because its
 * content no longer describes the file on disk; keeping it invites the model to
 * act on text that is gone.
 *
 * Neither rule reads the message bodies, so "identical call" is not a claim of
 * identical content — it is a claim that the newer result is the one worth
 * keeping. That is why the rule is confined to snapshot tools, and why the
 * elided copy is still spilled: superseded is a judgement, not a certainty, and
 * the model can always recall what was dropped.
 */
function applySupersession(
  candidates: readonly Candidate[],
  input: PruningInput,
  decisions: Map<string, Decision>,
): { superseded: number; reclaimedBytes: number } {
  const newestByKey = new Map<string, number>();
  for (const c of candidates) newestByKey.set(c.key, c.index);

  const tracked = new Set<string>();
  for (const c of candidates) {
    if (c.path !== undefined) tracked.add(c.path);
  }

  const mutatedAfter = new Map<string, number>();
  for (let i = 0; i < input.messages.length; i++) {
    const msg = input.messages[i];
    if (msg?.role !== "toolResult") continue;
    const { toolCallId } = msg;
    if (toolCallId === undefined) continue;
    const info = input.calls.get(toolCallId);
    if (info === undefined) continue;

    if (MUTATING_TOOLS.has(info.name)) {
      const path = callPath(info);
      if (path !== undefined) mutatedAfter.set(path, i);
      continue;
    }

    // Shell commands rewrite files too, and a read left standing against a file
    // a `sed -i` has since changed is exactly the stale copy this rule exists
    // to remove.
    if (info.name !== "bash") continue;
    const command = typeof info.arguments.command === "string" ? info.arguments.command : "";
    if (command === "") continue;
    for (const path of bashMutatedPaths(command, tracked)) mutatedAfter.set(path, i);
  }

  let superseded = 0;
  let reclaimedBytes = 0;

  for (const c of candidates) {
    if (decisions.get(c.toolCallId) === "superseded") continue;

    const newerIdentical =
      SNAPSHOT_TOOLS.has(c.toolName) && (newestByKey.get(c.key) ?? c.index) > c.index;
    const lastMutation = c.path === undefined ? undefined : mutatedAfter.get(c.path);
    const staleRead = c.toolName === "read" && lastMutation !== undefined && lastMutation > c.index;

    if (!newerIdentical && !staleRead) continue;

    decisions.set(c.toolCallId, "superseded");
    superseded++;
    reclaimedBytes += c.bytes;
  }

  return { superseded, reclaimedBytes };
}

/**
 * Decide which tool results to elide on this call.
 *
 * Supersession always runs. Lossy stubbing engages only under pressure, and
 * once engaged reclaims down to the low-water mark in one batch so the prompt
 * cache is invalidated once rather than every turn.
 */
export function planPruning(input: PruningInput): PruningPlan {
  const { messages, config, state } = input;
  const decisions = new Map(state.decisions);

  // A host with no usage API used to mean "stub everything past the protected
  // window, every turn" — the same indiscriminate rule the watermarks replaced,
  // pruning as hard at 5% fill as at 95%. Measuring the conversation and running
  // the ordinary watermarks against an assumed window is a crude signal, but a
  // crude pressure signal beats none, and it keeps one code path instead of two.
  const estimated = input.pressure === null;
  const pressure = input.pressure ?? estimatePressure(messages, config);
  // Scaled before dividing: `(tokens / window) * 100` lands a hair either side
  // of a round percentage, and the watermark comparisons are exact boundaries.
  const percent =
    pressure.tokens === null || pressure.contextWindow <= 0
      ? null
      : (pressure.tokens * 100) / pressure.contextWindow;

  const candidates = collectCandidates(input);
  if (candidates.length === 0) {
    return {
      decisions,
      engaged: state.engaged,
      stubbed: 0,
      superseded: 0,
      reclaimedBytes: 0,
      reason: "disabled-no-history",
      percent,
      estimated,
    };
  }

  const supersession = applySupersession(candidates, input, decisions);

  const cutoff = protectedFrom(messages, config.keepRecentTurns);
  const eligible = candidates.filter(
    (c) => c.index < cutoff && decisions.get(c.toolCallId) !== "superseded",
  );

  const countDecisions = (): { stubbed: number; superseded: number; reclaimedBytes: number } => {
    let stubbed = 0;
    let superseded = 0;
    let reclaimedBytes = 0;
    for (const c of candidates) {
      const d = decisions.get(c.toolCallId);
      if (d === "stub") {
        stubbed++;
        reclaimedBytes += c.bytes;
      } else if (d === "superseded") {
        superseded++;
        reclaimedBytes += c.bytes;
      }
    }
    return { stubbed, superseded, reclaimedBytes };
  };

  const finish = (engaged: boolean, reason: PruningReason): PruningPlan => ({
    decisions,
    engaged,
    ...countDecisions(),
    reason,
    percent,
    estimated,
  });

  // Usage temporarily unknown (typically just after compaction). Hold every
  // prior decision and add nothing lossy — compaction has just freed room.
  if (pressure.tokens === null || percent === null) {
    return finish(state.engaged, supersession.superseded > 0 ? "supersede-only" : "usage-unknown");
  }

  const engaged = state.engaged
    ? percent > config.lowWaterPercent
    : percent >= config.highWaterPercent;

  if (!engaged) {
    return finish(false, supersession.superseded > 0 ? "supersede-only" : "below-low-water");
  }

  const targetTokens = (pressure.contextWindow * config.lowWaterPercent) / 100;
  const needTokens = pressure.tokens - targetTokens;
  if (needTokens <= 0) {
    return finish(state.engaged, "below-low-water");
  }

  const pending = eligible.filter((c) => decisions.get(c.toolCallId) !== "stub");
  const availableBytes = pending.reduce((sum, c) => sum + c.bytes, 0);
  const minReclaimBytes =
    (pressure.contextWindow * config.minReclaimPercent * BYTES_PER_TOKEN) / 100;

  // Not worth a cache invalidation yet. Hold the frontier where it is and let
  // pressure build until one advance reclaims something meaningful.
  if (!state.engaged && availableBytes < minReclaimBytes) {
    return finish(false, "reclaim-too-small");
  }

  // Oldest first: the front of the conversation is furthest from the model's
  // current working set and, in a long context, the region it attends to least.
  let reclaimed = supersession.reclaimedBytes;
  const needBytes = needTokens * BYTES_PER_TOKEN;

  for (const c of pending) {
    if (reclaimed >= needBytes) break;
    decisions.set(c.toolCallId, "stub");
    reclaimed += c.bytes;
  }

  return finish(true, "engaged");
}

/** Size the conversation itself when the host will not say how full the window
 *  is. Uses the same chars/4 estimate pi applies to its own accounting. */
function estimatePressure(
  messages: readonly PlanMessage[],
  config: PruningConfig,
): ContextPressure {
  let bytes = 0;
  for (const msg of messages) bytes += msg.bytes;
  return {
    tokens: bytes / BYTES_PER_TOKEN,
    contextWindow: config.assumedContextWindowTokens,
  };
}

// ── Rendering ───────────────────────────────────────────────────────────

/**
 * Replacement text for an elided result.
 *
 * Always names the ref. A stub the model cannot expand is a dead end, and the
 * whole point of the artifact store is that it never has to be one.
 */
export function renderStub(
  toolName: string,
  lines: number,
  decision: Exclude<Decision, "keep">,
  ref: string | undefined,
): string {
  const why =
    decision === "superseded"
      ? "superseded by later output for the same target"
      : "elided from an older turn to free context";

  const recall =
    ref === undefined
      ? "Re-run the call if you need it."
      : `Recover with thrift_recall(ref="${ref}").`;

  return `[thrift: ${toolName} output, ${lines} lines, ${why}. ${recall}]`;
}
