/**
 * Input token pruning — reduce what the LLM receives.
 *
 * Strategy A (tool_result hook):
 *   Truncate oversized tool results at source before they enter the session.
 *   bash keeps the tail (exit codes, errors); everything else keeps the head.
 *
 * Strategy B (context hook):
 *   Replace stale tool output from older turns with compact one-line stubs
 *   before each LLM call, so only the most recent turns carry full output.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { formatSize, truncateHead, truncateTail } from "@earendil-works/pi-coding-agent";
import type { ThriftConfig } from "./config.js";

// ── Public stats (read by index.ts for /prune-stats) ───────────────────

export interface CacheState {
  /** Wall-clock time of the last LLM request (0 = none yet). */
  lastRequestTime: number;
  /** Provider used for the last request, for invalidation on switch. */
  lastProvider: string | null;
  /**
   * Per-tool-call stub decisions, sticky for the lifetime of the cache
   * window. Keyed by toolCallId so duplicate prefixes within a session
   * collapse to the same decision.
   */
  decisions: Map<string, "kept" | "stubbed">;
  /** Last-resolved TTL in ms (for stats display). */
  lastTTL: number;
  /** Whether the cache was considered alive on the last context call. */
  lastCacheAlive: boolean;
}

export interface InputStats {
  sourceBytesSaved: number;
  sourceResultsPruned: number;
  lastContextBytesSaved: number;
  lastContextStubbed: number;
  /** Cache-awareness state, exposed for /tp ttl + /tp stats. */
  cache: CacheState;
}

// ── Registration ────────────────────────────────────────────────────────

export function registerInputPruning(pi: ExtensionAPI, config: ThriftConfig): InputStats {
  const stats: InputStats = {
    sourceBytesSaved: 0,
    sourceResultsPruned: 0,
    lastContextBytesSaved: 0,
    lastContextStubbed: 0,
    cache: {
      lastRequestTime: 0,
      lastProvider: null,
      decisions: new Map(),
      lastTTL: 0,
      lastCacheAlive: false,
    },
  };

  // ───────────────────────────────────────────────────────────────
  // Cache lifecycle — stamp every outgoing request so the context hook can
  // tell whether the provider's prompt cache is still warm. We update on
  // `before_provider_request` (optimistic): if the request fails we just
  // pay a few extra tokens on the next call — strictly better than risking
  // a cache invalidation by re-stubbing inside a live window.
  // ───────────────────────────────────────────────────────────────
  pi.on("before_provider_request", (_event, ctx) => {
    if (!config.enabled || !config.input.enabled) return;
    stats.cache.lastRequestTime = Date.now();
    stats.cache.lastProvider = ctx.model?.provider ?? null;
  });

  // ────────────────────────────────────────────────────────────────────
  // Strategy A — truncate tool results at source
  //
  // Fires once per tool result.  The truncated content is what gets
  // stored in the session, so the savings are permanent.
  // ────────────────────────────────────────────────────────────────────

  pi.on("tool_result", async (event, ctx) => {
    if (!config.enabled || !config.input.enabled) return;

    // Keep error output intact — the LLM needs full diagnostics
    if (event.isError) return;

    const maxBytes = config.input.maxResultBytes[event.toolName];
    if (maxBytes === undefined) return;

    // Find the first text block (skip images)
    const textIdx = event.content.findIndex((c) => c.type === "text");
    if (textIdx === -1) return;

    const block = event.content[textIdx];
    if (block.type !== "text") return;

    const originalBytes = Buffer.byteLength(block.text, "utf-8");
    if (originalBytes <= maxBytes) return;

    // bash: keep tail (errors, exit codes, final output)
    // everything else: keep head (file start, first matches)
    const truncFn = event.toolName === "bash" ? truncateTail : truncateHead;
    const result = truncFn(block.text, {
      maxBytes,
      maxLines: config.input.maxResultLines,
    });

    if (!result.truncated) return;

    const omittedLines = result.totalLines - result.outputLines;
    const omittedBytes = result.totalBytes - result.outputBytes;
    const notice =
      `\n\n[thrift: ${result.outputLines}/${result.totalLines} lines` +
      ` (${formatSize(result.outputBytes)}/${formatSize(result.totalBytes)}).` +
      ` ${omittedLines} lines (${formatSize(omittedBytes)}) omitted.` +
      (event.toolName === "read"
        ? ` IMPORTANT: file was truncated. Before editing lines beyond this point, re-read the target region with offset/limit.]`
        : `]`);

    const newText = result.content + notice;
    stats.sourceBytesSaved += originalBytes - Buffer.byteLength(newText, "utf-8");
    stats.sourceResultsPruned++;

    // Preserve non-text blocks (images etc.)
    const newContent = [...event.content];
    newContent[textIdx] = { type: "text" as const, text: newText };

    if (config.showStatus) {
      ctx.ui.setStatus("thrift", `✂ ${formatSize(stats.sourceBytesSaved)} truncated`);
    }

    return { content: newContent };
  });

  // ────────────────────────────────────────────────────────────────────
  // Strategy B — prune stale tool output from older turns
  //
  // Fires before every LLM call.  The messages array is a deep copy, so
  // mutations here do NOT affect the stored session — they only affect
  // what the LLM sees on this particular call.
  //
  // Turn counting: walk backwards from the newest message, increment a
  // counter each time a user message is encountered.  Once we've passed
  // `keepRecentTurns` user messages, everything before that cutoff gets
  // tool results replaced with stubs.
  // ────────────────────────────────────────────────────────────────────

  pi.on("context", async (event, ctx) => {
    if (!config.enabled || !config.input.enabled) return;

    const messages = event.messages;
    const prunableTools = new Set(Object.keys(config.input.maxResultBytes));

    // ──────────────────────────────────────────────────────────────
    // Cache-awareness gate
    //
    // The provider's prompt cache only buys us anything if the bytes we
    // send this turn match the bytes we sent last turn. Re-stubbing a
    // turn that was previously sent un-stubbed mutates the prefix and
    // invalidates the cache from that point on.
    //
    // Strategy:
    //   • If the cache is dead (TTL elapsed, provider switched, or first
    //     call of session) → wipe the decision map and apply the standard
    //     keepRecentTurns rule. Cheap to be aggressive.
    //   • If the cache is warm → honor every prior decision. Only new
    //     toolResults (added since the last call) get a fresh decision.
    // ──────────────────────────────────────────────────────────────
    const now = Date.now();
    const provider = ctx.model?.provider ?? "unknown";
    const ttl = config.input.providerTTLs[provider] ?? config.input.defaultTTL;
    stats.cache.lastTTL = ttl;

    // Provider switch → the new provider has its own (empty) cache
    if (stats.cache.lastProvider !== null && stats.cache.lastProvider !== provider) {
      stats.cache.decisions.clear();
      stats.cache.lastRequestTime = 0;
    }

    const cacheAlive =
      config.input.cacheAware &&
      ttl > 0 &&
      stats.cache.lastRequestTime > 0 &&
      now - stats.cache.lastRequestTime < ttl;
    stats.cache.lastCacheAlive = cacheAlive;

    // Cache cold → forget all prior decisions, re-prune from scratch
    if (!cacheAlive) {
      stats.cache.decisions.clear();
    }

    // Locate the cutoff: the Nth user message from the end
    let turnsSeen = 0;
    let cutoffIndex = -1;

    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "user") {
        turnsSeen++;
        if (turnsSeen >= config.input.keepRecentTurns) {
          cutoffIndex = i;
          break;
        }
      }
    }

    // Not enough history to prune anything
    if (cutoffIndex <= 0) return;

    let callBytes = 0;
    let callStubs = 0;

    const pruned = messages.map((msg, i) => {
      // Only touch toolResult messages — leave user, assistant,
      // compactionSummary, branchSummary, custom messages alone
      if (msg.role !== "toolResult") return msg;

      // Narrow to ToolResultMessage shape
      const toolMsg = msg as {
        role: "toolResult";
        toolCallId: string;
        toolName: string;
        content: Array<{ type: string; text?: string }>;
        isError: boolean;
        timestamp: number;
      };

      // Keep error results — they're small and diagnostically important
      if (toolMsg.isError) return msg;

      // Only prune tools known to produce large output
      if (!prunableTools.has(toolMsg.toolName)) return msg;

      // Measure original text
      const textBlock = toolMsg.content.find((c) => c.type === "text");
      const originalText = textBlock?.text ?? "";
      const originalBytes = Buffer.byteLength(originalText, "utf-8");

      // Skip tiny results — not worth stubbing, decision is implicit "kept"
      if (originalBytes < config.input.stubThresholdBytes) return msg;

      // ── Decide: stub or keep ────────────────────────────────────────
      const callId = toolMsg.toolCallId;
      const prior = stats.cache.decisions.get(callId);

      let shouldStub: boolean;
      if (cacheAlive && prior !== undefined) {
        // Honor prior decision — monotonic, cache-stable
        shouldStub = prior === "stubbed";
      } else {
        // First time seeing this result, OR cache cold (just cleared)
        // → apply the keepRecentTurns rule
        shouldStub = i < cutoffIndex;
        stats.cache.decisions.set(callId, shouldStub ? "stubbed" : "kept");
      }

      if (!shouldStub) return msg;

      const lines = originalText.split("\n").length;
      const stub = `[${toolMsg.toolName} output — ${lines} lines, pruned from older turn]`;

      callBytes += originalBytes - Buffer.byteLength(stub, "utf-8");
      callStubs++;

      return {
        ...msg,
        content: [{ type: "text" as const, text: stub }],
      };
    });

    stats.lastContextBytesSaved = callBytes;
    stats.lastContextStubbed = callStubs;

    if (config.showStatus) {
      const cacheGlyph = config.input.cacheAware
        ? cacheAlive
          ? " \uD83D\uDD25" // warm cache, decisions sticky
          : " \u2744" //          cold cache, free to re-prune
        : "";
      const stubsPart = callStubs > 0 ? `, ${callStubs} stubs` : "";
      ctx.ui.setStatus(
        "thrift",
        `✂ ${formatSize(stats.sourceBytesSaved)} truncated${stubsPart}${cacheGlyph}`,
      );
    } else {
      ctx.ui.setStatus("thrift", "");
    }

    if (callStubs === 0) return;
    return { messages: pruned };
  });

  return stats;
}
