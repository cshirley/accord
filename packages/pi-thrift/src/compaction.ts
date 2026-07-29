/**
 * Compaction support.
 *
 * pi summarises by serialising the conversation and cutting every tool result
 * at 2000 characters. For a 40KB file read that means the summary is written
 * from the first 2000 characters of the file — usually the licence header and
 * the imports, which is close to the least informative slice available.
 *
 * Thrift already knows how to spend a small budget well, so this hook runs the
 * same structure-aware reducers over the messages destined for the summariser
 * before pi serialises them. The cut still happens, but it now falls on a
 * declaration skeleton or a folded log instead of a raw prefix.
 *
 * The hook deliberately returns nothing. Taking over compaction outright would
 * mean owning model selection, credentials, retries and the summary format;
 * enriching pi's input keeps all of that where it belongs and degrades to a
 * no-op if pi ever stops reading the array we mutate.
 *
 * Reduction here spills like everywhere else. `turnPrefixMessages` survive the
 * compaction and carry on into the next context, so a block reduced without a
 * recall ref is content nothing can bring back.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type ArtifactStore, findArtifactRef, stripArtifactNotice } from "./artifacts.js";
import type { ThriftConfig } from "./config.js";
import type { InputStats } from "./input.js";
import { reduceToolOutput } from "./reducers.js";

/** Below pi's own serialisation cut there is nothing to gain by reducing. */
const REDUCE_ABOVE_BYTES = 2_000;

interface MutableToolResult {
  role: string;
  toolName?: string;
  content?: Array<{ type: string; text?: string }>;
}

export async function reduceMessagesInPlace(
  messages: unknown,
  config: ThriftConfig,
  store: ArtifactStore,
): Promise<number> {
  if (!Array.isArray(messages)) return 0;

  let reduced = 0;

  for (const message of messages as MutableToolResult[]) {
    if (message?.role !== "toolResult" || !Array.isArray(message.content)) continue;

    const toolName = message.toolName ?? "";
    for (const block of message.content) {
      if (block?.type !== "text" || typeof block.text !== "string") continue;
      const original = block.text;
      if (Buffer.byteLength(original, "utf-8") <= REDUCE_ABOVE_BYTES) continue;

      const result = reduceToolOutput(toolName, original, {
        maxEntries: config.input.maxListEntries,
      });
      if (!result.reduced) continue;

      // A block reduced at source already names the artifact holding its full
      // output; reuse that rather than storing the abbreviated copy again.
      const ref =
        findArtifactRef(original) ?? (await store.spill(toolName, toolName, original))?.ref;
      if (ref === undefined) continue;

      block.text =
        `${stripArtifactNotice(result.text)}\n\n` +
        `[thrift: reduced for compaction. Full output: thrift_recall(ref="${ref}").]`;
      reduced++;
    }
  }

  return reduced;
}

export function registerCompactionSupport(
  pi: ExtensionAPI,
  config: ThriftConfig,
  stats: InputStats,
): void {
  pi.on("session_before_compact", async (event) => {
    if (!config.enabled || !config.input.enabled || !config.input.reduce) return;

    const { preparation } = event;
    await reduceMessagesInPlace(preparation.messagesToSummarize, config, stats.store);
    await reduceMessagesInPlace(preparation.turnPrefixMessages, config, stats.store);
  });

  // Compaction removes the very messages the decision map describes, and frees
  // enough room that the hysteresis latch should not stay engaged. Holding
  // either would make the next call prune against a conversation that no
  // longer exists.
  pi.on("session_compact", async () => {
    stats.state = { decisions: new Map(), engaged: false };
    stats.lastContextBytesSaved = 0;
    stats.lastContextStubbed = 0;
    stats.lastContextSuperseded = 0;
    stats.lastContextHeldBack = 0;
    stats.lastReason = "idle";
  });
}
