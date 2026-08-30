/**
 * thrift — cut tokens on both sides of the conversation.
 *
 * Barrel export that composes the modules:
 *
 *   reducers.ts   Pure structure-aware text reduction (code skeleton, log
 *                 folding, list trimming). No I/O, no config.
 *   policy.ts     Pure pruning decisions — what to elide and under how much
 *                 context pressure.
 *   artifacts.ts  Spill store plus the `thrift_recall` tool, so every elision
 *                 stays reversible.
 *   input.ts      Wires the above into the tool_result and context hooks.
 *   compaction.ts Feeds pi's summariser reduced input instead of raw prefixes.
 *   output.ts     Reduces OUTPUT tokens via a terse system-prompt fragment.
 *
 * Config persists to ~/.pi/agent/thrift.json.
 * Output level persists per-session via pi.appendEntry().
 *
 * Commands (all under /thrift, alias /tp):
 *
 *   /thrift                  Quick overview (current state)
 *   /thrift on|off           Enable or disable the entire extension
 *   /thrift stats            Show combined pruning statistics
 *   /thrift output [level]   Set output compression (lite/full/ultra/off)
 *   /thrift input [on|off]   Enable or disable input pruning
 *   /thrift reduce [on|off]  Structure-aware reduction vs plain truncation
 *   /thrift budget [lo hi]   Inspect/set context-pressure watermarks
 *   /thrift cache [on|off]   Monotonic (cache-stable) elision decisions
 *   /thrift recall           List recoverable artifacts
 *   /thrift config           Interactive settings dialog
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatSize } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { ArtifactStore } from "./artifacts.js";
import { registerCompactionSupport } from "./compaction.js";
import { loadConfig, OUTPUT_LEVELS, type OutputLevel, STOP_ALIASES, saveConfig } from "./config.js";
import {
  LEGACY_OUTPUT_LEVEL_ENTRY_TYPE,
  OUTPUT_LEVEL_ENTRY_TYPE,
  registerOutputLevelEntryRenderer,
} from "./entry-render.js";
import { type InputStats, registerInputPruning } from "./input.js";
import { OUTPUT_LEVEL_OPTIONS, registerOutputPruning } from "./output.js";

// Session entry type for output level persistence (see entry-render.ts).

// ── Subcommand routing ──────────────────────────────────────────────────

const SUBCOMMANDS: AutocompleteItem[] = [
  { value: "on", label: "on", description: "Enable the extension" },
  { value: "off", label: "off", description: "Disable the extension entirely" },
  { value: "stats", label: "stats", description: "Show pruning statistics" },
  { value: "output", label: "output", description: "Set output compression level" },
  { value: "input", label: "input", description: "Toggle input pruning (on/off)" },
  { value: "reduce", label: "reduce", description: "Structure-aware reduction on/off" },
  { value: "budget", label: "budget", description: "Context-pressure watermarks" },
  { value: "cache", label: "cache", description: "Monotonic elision decisions" },
  { value: "recall", label: "recall", description: "List recoverable artifacts" },
  { value: "config", label: "config", description: "Open settings dialog" },
];

const ON_OFF: AutocompleteItem[] = [
  { value: "on", label: "on", description: "Enable" },
  { value: "off", label: "off", description: "Disable" },
];

// ── Helpers ─────────────────────────────────────────────────────────────

const REASON_TEXT: Record<string, string> = {
  idle: "nothing pruned yet",
  "disabled-no-history": "no prunable history",
  "supersede-only": "removed redundant results only",
  "below-low-water": "below low-water mark, nothing elided",
  "usage-unknown": "context size unknown, holding steady",
  engaged: "above high-water mark, eliding",
  "reclaim-too-small": "too little to reclaim, waiting",
};

/** Context fill, flagged when it came from thrift's own measurement rather
 *  than the host, since the two deserve different amounts of trust. */
function formatFill(stats: InputStats): string {
  if (stats.lastPercent === null) return "unknown";
  const pct = `${Math.round(stats.lastPercent)}%`;
  return stats.lastEstimated ? `${pct} (estimated, host reports no usage)` : pct;
}

// ── Extension ───────────────────────────────────────────────────────────

export default async function (pi: ExtensionAPI) {
  const config = await loadConfig();
  const store = new ArtifactStore();

  const inputStats = registerInputPruning(pi, config, store);
  const output = registerOutputPruning(pi, config);
  registerCompactionSupport(pi, config, inputStats);
  registerOutputLevelEntryRenderer(pi);

  // A new provider has its own empty prompt cache, so decisions tuned to keep
  // the previous provider's prefix stable are worthless. Drop them and let the
  // planner rebuild against the new cache.
  pi.on("model_select", (event) => {
    if (!config.enabled) return;
    const prev = event.previousModel?.provider;
    const next = event.model.provider;
    if (prev !== undefined && prev !== next) {
      inputStats.state = { decisions: new Map(), engaged: false };
    }
  });

  pi.on("session_shutdown", async () => {
    await store.dispose();
  });

  function clearAllStatus(ctx: Pick<ExtensionContext, "ui">) {
    ctx.ui.setStatus("thrift", "");
    ctx.ui.setStatus("thrift-output", "");
  }

  // ── Session lifecycle: restore output level from session entries ──────
  pi.on("session_start", async (_event, ctx) => {
    if (!config.enabled) {
      clearAllStatus(ctx);
      return;
    }
    let restoredLevel: string | null = null;

    for (const entry of ctx.sessionManager.getEntries()) {
      if (
        entry.type === "custom" &&
        (entry.customType === OUTPUT_LEVEL_ENTRY_TYPE ||
          entry.customType === LEGACY_OUTPUT_LEVEL_ENTRY_TYPE)
      ) {
        restoredLevel = (entry.data as { level?: string })?.level ?? null;
      }
    }

    if (restoredLevel !== null) {
      output.setLevel(restoredLevel as OutputLevel);
    } else if (config.output.level !== "off") {
      output.setLevel(config.output.level);
      pi.appendEntry(OUTPUT_LEVEL_ENTRY_TYPE, { level: config.output.level });
    }

    output.syncStatus(ctx);
  });

  // ── Unified command: /thrift [subcommand] [args] ─────────────────────

  function registerNamespacedCommand(name: string) {
    pi.registerCommand(name, {
      description:
        "thrift: on|off | stats | output [level] | input | reduce | budget | cache | recall | config",
      getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
        const parts = prefix.trimStart().split(/\s+/);

        if (parts.length <= 1) {
          const filtered = SUBCOMMANDS.filter((s) => s.value.startsWith(parts[0] ?? ""));
          return filtered.length > 0 ? filtered : null;
        }

        const sub = parts[0]?.toLowerCase();
        const p = parts[1] ?? "";

        const scoped = (items: AutocompleteItem[]): AutocompleteItem[] | null => {
          const filtered = items
            .filter((o) => o.value.startsWith(p))
            .map((o) => ({ ...o, value: `${sub} ${o.value}` }));
          return filtered.length > 0 ? filtered : null;
        };

        if (sub === "output") return scoped([...OUTPUT_LEVEL_OPTIONS]);
        if (sub === "input" || sub === "reduce") return scoped(ON_OFF);
        if (sub === "cache") {
          return scoped([
            ...ON_OFF,
            { value: "reset", label: "reset", description: "Clear elision decisions" },
          ]);
        }
        return null;
      },

      handler: async (rawArgs, ctx) => {
        const parts = (rawArgs ?? "").trim().split(/\s+/).filter(Boolean);
        const sub = parts[0]?.toLowerCase() ?? "";
        const arg = parts[1]?.toLowerCase() ?? "";

        // ── /thrift on|off → master enable/disable ──────────────────────
        if (sub === "on" || sub === "off") {
          config.enabled = sub === "on";
          await saveConfig(config);
          if (!config.enabled) {
            clearAllStatus(ctx);
          } else {
            output.syncStatus(ctx);
          }
          ctx.ui.notify(
            config.enabled ? "Thrift enabled." : "Thrift disabled — all pruning suspended.",
            "info",
          );
          return;
        }

        // ── /thrift (no subcommand) → quick overview ────────────────────
        if (!sub) {
          const pct = formatFill(inputStats);
          ctx.ui.notify(
            [
              "thrift",
              `  enabled: ${config.enabled ? "on" : "OFF"}`,
              `  input:   ${config.input.enabled ? "on" : "off"} (reduce ${config.input.reduce ? "on" : "off"})`,
              `  output:  ${output.getLevel()}`,
              `  context: ${pct} of window — ${REASON_TEXT[inputStats.lastReason] ?? inputStats.lastReason}`,
              `  budget:  elide above ${config.input.highWaterPercent}%, down to ${config.input.lowWaterPercent}%`,
              `  recall:  ${store.size} artifacts (${formatSize(store.totalBytes)})`,
              "",
              "Subcommands: on, off, stats, output, input, reduce, budget, cache, recall, config",
            ].join("\n"),
            "info",
          );
          return;
        }

        // ── stats ───────────────────────────────────────────────────────
        if (sub === "stats") {
          const limits = Object.entries(config.input.maxResultBytes)
            .map(([tool, bytes]) => `${tool}=${formatSize(bytes)}`)
            .join(", ");
          const pct = formatFill(inputStats);

          ctx.ui.notify(
            [
              "── thrift stats ──",
              "",
              `  Output level:  ${output.getLevel()}`,
              `  Input pruning: ${config.input.enabled ? "on" : "off"}`,
              `  Reduction:     ${config.input.reduce ? "structure-aware" : "plain truncation"}`,
              "",
              "  At source (tool_result):",
              `    ${inputStats.sourceResultsReduced} results reduced`,
              `    ${formatSize(inputStats.sourceBytesSaved)} saved (permanent, recoverable)`,
              "",
              "  Per LLM call (context):",
              `    ${inputStats.lastContextSuperseded} redundant results collapsed`,
              `    ${inputStats.lastContextStubbed} stale results elided`,
              `    ~${formatSize(inputStats.lastContextBytesSaved)} not sent on last call`,
              ...(inputStats.lastContextHeldBack > 0
                ? [`    ${inputStats.lastContextHeldBack} kept whole — could not be spilled`]
                : []),
              "",
              "  Pressure:",
              `    Context fill:  ${pct}`,
              `    Watermarks:    engage ${config.input.highWaterPercent}%, release ${config.input.lowWaterPercent}%`,
              `    State:         ${inputStats.state.engaged ? "engaged" : "idle"} — ${REASON_TEXT[inputStats.lastReason] ?? inputStats.lastReason}`,
              `    Decisions:     ${inputStats.state.decisions.size} tracked`,
              ...(inputStats.lastCompactionReason
                ? [
                    "",
                    "  Compaction:",
                    `    Last reason:   ${inputStats.lastCompactionReason}`,
                    `    Tokens before: ${inputStats.lastCompactionTokensBefore ?? "unknown"}`,
                    ...(inputStats.lastCompactionUsageTokens !== null
                      ? [`    Summary usage: ${inputStats.lastCompactionUsageTokens} tokens`]
                      : []),
                  ]
                : []),
              "",
              "  Recall:",
              `    ${store.size} artifacts held (${formatSize(store.totalBytes)})`,
              ...(store.failures > 0
                ? [
                    `    ${store.failures} spills failed — those results were left whole`,
                    `    Last error: ${store.lastError}`,
                  ]
                : []),
              "",
              "  Config:",
              `    Keep recent turns: ${config.input.keepRecentTurns}`,
              `    Stub threshold:    ${formatSize(config.input.stubThresholdBytes)}`,
              `    Reduce above:      ${limits}`,
              `    File: ~/.pi/agent/thrift.json`,
            ].join("\n"),
            "info",
          );
          return;
        }

        // ── budget [low high] ───────────────────────────────────────────
        if (sub === "budget") {
          if (!arg) {
            ctx.ui.notify(
              [
                "── context-pressure budget ──",
                "",
                `  Engage elision at: ${config.input.highWaterPercent}% of context window`,
                `  Reclaim down to:   ${config.input.lowWaterPercent}%`,
                `  Minimum reclaim:   ${config.input.minReclaimPercent}% before engaging`,
                "",
                "  Below the low mark nothing is elided for pressure. Results",
                "  superseded by later work are still collapsed at any fill, and",
                "  everything removed stays recoverable with thrift_recall.",
                "",
                "  Usage: /tp budget <low> <high>   e.g. /tp budget 55 75",
              ].join("\n"),
              "info",
            );
            return;
          }

          const low = Number.parseInt(arg, 10);
          const high = Number.parseInt(parts[2] ?? "", 10);
          if (!Number.isFinite(low) || !Number.isFinite(high)) {
            ctx.ui.notify("Usage: /tp budget <low> <high>, e.g. /tp budget 55 75", "error");
            return;
          }
          if (low < 0 || high > 100 || low >= high) {
            ctx.ui.notify(`Need 0 <= low < high <= 100. Got low=${low}, high=${high}.`, "error");
            return;
          }

          config.input.lowWaterPercent = low;
          config.input.highWaterPercent = high;
          await saveConfig(config);
          ctx.ui.notify(`Elide above ${high}% of context, reclaim down to ${low}%.`, "info");
          return;
        }

        // ── cache [on|off|reset] ────────────────────────────────────────
        if (sub === "cache" || sub === "ttl") {
          if (!arg) {
            ctx.ui.notify(
              [
                "── monotonic elision ──",
                "",
                `  Monotonic: ${config.input.monotonic ? "on" : "off"}`,
                `  Decisions: ${inputStats.state.decisions.size} tracked`,
                `  State:     ${inputStats.state.engaged ? "engaged" : "idle"}`,
                "",
                "  Once a result is elided it stays elided. Prompt caches match",
                "  on prefixes, so a decision that flips back invalidates the",
                "  cache twice and changes what the model thinks it has seen.",
                "",
                "  Usage: /tp cache on|off|reset",
              ].join("\n"),
              "info",
            );
            return;
          }

          if (arg === "reset" || arg === "clear") {
            inputStats.state = { decisions: new Map(), engaged: false };
            ctx.ui.notify("Elision decisions cleared.", "info");
            return;
          }

          if (arg !== "on" && arg !== "off") {
            ctx.ui.notify(`Unknown: "${arg}". Use: on, off, reset`, "error");
            return;
          }

          config.input.monotonic = arg === "on";
          await saveConfig(config);
          ctx.ui.notify(`Monotonic elision ${arg}.`, "info");
          return;
        }

        // ── recall ──────────────────────────────────────────────────────
        if (sub === "recall") {
          const artifacts = store.list();
          if (artifacts.length === 0) {
            ctx.ui.notify("No artifacts held — nothing has been elided yet.", "info");
            return;
          }
          const rows = artifacts
            .slice(0, 20)
            .map((a) => `  ${a.ref}  ${formatSize(a.bytes).padStart(8)}  ${a.label}`);
          ctx.ui.notify(
            [
              `── recoverable artifacts (${artifacts.length}) ──`,
              "",
              ...rows,
              "",
              '  The model recovers any of these with thrift_recall(ref="...").',
            ].join("\n"),
            "info",
          );
          return;
        }

        // ── output [level|stop] ─────────────────────────────────────────
        if (sub === "output") {
          let newLevel: OutputLevel;

          if (!arg) {
            newLevel = output.getLevel() === "off" ? "full" : "off";
          } else if (STOP_ALIASES.has(arg)) {
            newLevel = "off";
          } else if (OUTPUT_LEVELS.includes(arg as OutputLevel)) {
            newLevel = arg as OutputLevel;
          } else {
            ctx.ui.notify(`Unknown level: "${arg}". Use: ${OUTPUT_LEVELS.join(", ")}`, "error");
            return;
          }

          output.setLevel(newLevel);
          pi.appendEntry(OUTPUT_LEVEL_ENTRY_TYPE, { level: newLevel });
          output.syncStatus(ctx);

          ctx.ui.notify(
            newLevel === "off" ? "Output pruning off." : `Output: terse ${newLevel}`,
            "info",
          );
          return;
        }

        // ── input [on|off] / reduce [on|off] ────────────────────────────
        if (sub === "input" || sub === "reduce") {
          const current = sub === "input" ? config.input.enabled : config.input.reduce;
          let next: boolean;

          if (!arg) next = !current;
          else if (arg === "on") next = true;
          else if (arg === "off") next = false;
          else {
            ctx.ui.notify(`Unknown: "${arg}". Use: on, off`, "error");
            return;
          }

          if (sub === "input") config.input.enabled = next;
          else config.input.reduce = next;
          await saveConfig(config);

          if (sub === "input" && !next) ctx.ui.setStatus("thrift", "");
          ctx.ui.notify(
            sub === "input"
              ? `Input pruning ${next ? "on" : "off"}.`
              : `Reduction: ${next ? "structure-aware" : "plain truncation"}.`,
            "info",
          );
          return;
        }

        // ── config ──────────────────────────────────────────────────────
        if (sub === "config") {
          await output.openConfig(ctx);
          return;
        }

        ctx.ui.notify(
          `Unknown subcommand: "${sub}". Use: on, off, stats, output, input, reduce, budget, cache, recall, config`,
          "error",
        );
      },
    });
  }

  registerNamespacedCommand("thrift");
  registerNamespacedCommand("tp");
}
