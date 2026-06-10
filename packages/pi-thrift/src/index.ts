/**
 * thrift — cut tokens on both sides of the conversation.
 *
 * Barrel export that composes two independent modules:
 *
 *   input.ts   Reduces INPUT tokens — truncates tool results at source and
 *              stubs stale output from older turns before each LLM call.
 *
 *   output.ts  Reduces OUTPUT tokens — injects a system-prompt fragment that
 *              instructs the model to respond tersely.
 *              Inspired by pi-caveman by @jonjonrankin.
 *
 * Config persists to ~/.pi/agent/thrift.json.
 * Output level persists per-session via pi.appendEntry().
 *
 * Commands (all under /thrift, alias /tp):
 *
 *   /thrift                  Quick overview (current state)
 *   /thrift on|off           Enable or disable the entire extension
 *   /thrift stats            Show combined pruning statistics
 *   /thrift output [level]   Set output compression (lite/full/ultra/…/off)
 *   /thrift input [on|off]   Enable or disable input pruning
 *   /thrift ttl [arg]        Inspect/override cache-aware TTL
 *   /thrift config           Interactive settings dialog
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { formatSize } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { loadConfig, OUTPUT_LEVELS, type OutputLevel, STOP_ALIASES, saveConfig } from "./config.js";
import { registerInputPruning } from "./input.js";
import { OUTPUT_LEVEL_OPTIONS, registerOutputPruning } from "./output.js";

// Session entry type for output level persistence.
const OUTPUT_LEVEL_ENTRY = "thrift-output-level";
/** Legacy session entry key — read for backward compat with old sessions. */
const LEGACY_OUTPUT_LEVEL_ENTRY = "tp-output-level";

// ── Subcommand routing ──────────────────────────────────────────────────

const SUBCOMMANDS: AutocompleteItem[] = [
  { value: "on", label: "on", description: "Enable the extension" },
  { value: "off", label: "off", description: "Disable the extension entirely" },
  { value: "stats", label: "stats", description: "Show pruning statistics" },
  { value: "output", label: "output", description: "Set output compression level" },
  { value: "input", label: "input", description: "Toggle input pruning (on/off)" },
  { value: "ttl", label: "ttl", description: "Inspect/override cache-aware TTL" },
  { value: "config", label: "config", description: "Open settings dialog" },
];

// ── Helpers ─────────────────────────────────────────────────────────────

function formatDuration(ms: number): string {
  if (ms <= 0) return "0s";
  if (ms < 1_000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.round(ms / 1_000)}s`;
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
  return `${(ms / 3_600_000).toFixed(1)}h`;
}

function parseDuration(s: string): number | null {
  // Accept: "5m", "300s", "30000", "1h", "0" (disable)
  const m = s.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m|h)?$/);
  if (!m) return null;
  const [, numStr, unit] = m;
  if (numStr === undefined) return null;
  const n = Number.parseFloat(numStr);
  switch (unit) {
    case "h":
      return n * 3_600_000;
    case "m":
      return n * 60_000;
    case "s":
      return n * 1_000;
    case "ms":
      return n;
    default:
      return n; // bare number = ms
  }
}

// ── Extension ───────────────────────────────────────────────────────────

export default async function (pi: ExtensionAPI) {
  // ── Load persistent config (async factory — awaited before session_start)
  const config = await loadConfig();

  // ── Wire up both modules against the same config object ──────────────
  const inputStats = registerInputPruning(pi, config);
  const output = registerOutputPruning(pi, config);

  // ── Provider switch: invalidate cache-aware decision state ───────────
  // The new provider has its own (empty) prompt cache, so any sticky
  // decisions we accumulated for the previous provider are meaningless.
  // input.ts also detects this on the next context call, but resetting
  // here keeps /tp ttl output honest in the gap between switch and call.
  pi.on("model_select", (event) => {
    if (!config.enabled) return;
    const prev = event.previousModel?.provider;
    const next = event.model.provider;
    if (prev !== undefined && prev !== next) {
      inputStats.cache.decisions.clear();
      inputStats.cache.lastRequestTime = 0;
      inputStats.cache.lastProvider = next;
      inputStats.cache.lastCacheAlive = false;
    }
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
        (entry.customType === OUTPUT_LEVEL_ENTRY || entry.customType === LEGACY_OUTPUT_LEVEL_ENTRY)
      ) {
        restoredLevel = (entry.data as { level?: string })?.level ?? null;
      }
    }

    if (restoredLevel !== null) {
      // Resuming a session — use the persisted level
      output.setLevel(restoredLevel as OutputLevel);
    } else if (config.output.level !== "off") {
      // New session — apply config default and persist it
      output.setLevel(config.output.level);
      pi.appendEntry(OUTPUT_LEVEL_ENTRY, { level: config.output.level });
    }

    output.syncStatus(ctx);
  });

  // ── Unified command: /thrift [subcommand] [args] ───────────────

  function registerNamespacedCommand(name: string) {
    pi.registerCommand(name, {
      description: "thrift: on|off | stats | output [level] | input [on|off] | ttl | config",
      getArgumentCompletions: (prefix: string): AutocompleteItem[] | null => {
        const parts = prefix.trimStart().split(/\s+/);

        // First word: subcommand
        if (parts.length <= 1) {
          const filtered = SUBCOMMANDS.filter((s) => s.value.startsWith(parts[0] ?? ""));
          return filtered.length > 0 ? filtered : null;
        }

        // Second word: subcommand-specific values
        const sub = parts[0]?.toLowerCase();

        if (sub === "output") {
          const p = parts[1] ?? "";
          const items = OUTPUT_LEVEL_OPTIONS.filter((o) => o.value.startsWith(p)).map((o) => ({
            ...o,
            value: `output ${o.value}`,
          }));
          return items.length > 0 ? items : null;
        }

        if (sub === "ttl") {
          const p = parts[1] ?? "";
          const items = [
            { value: "on", label: "on", description: "Enable cache-aware stubbing" },
            { value: "off", label: "off", description: "Disable cache-aware stubbing" },
            { value: "5m", label: "5m", description: "Set default TTL to 5 minutes" },
            { value: "10m", label: "10m", description: "Set default TTL to 10 minutes" },
            { value: "1h", label: "1h", description: "Set default TTL to 1 hour" },
          ]
            .filter((o) => o.value.startsWith(p))
            .map((o) => ({ ...o, value: `ttl ${o.value}` }));
          return items.length > 0 ? items : null;
        }

        if (sub === "input") {
          const p = parts[1] ?? "";
          const items = [
            { value: "on", label: "on", description: "Enable input pruning" },
            { value: "off", label: "off", description: "Disable input pruning" },
          ]
            .filter((o) => o.value.startsWith(p))
            .map((o) => ({ ...o, value: `input ${o.value}` }));
          return items.length > 0 ? items : null;
        }

        return null;
      },

      handler: async (rawArgs, ctx) => {
        const parts = (rawArgs ?? "").trim().split(/\s+/).filter(Boolean);
        const sub = parts[0]?.toLowerCase() ?? "";
        const arg = parts[1]?.toLowerCase() ?? "";

        // ── /thrift on|off → master enable/disable ──────────────
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

        // ── /thrift (no subcommand) → quick overview ──────────────
        if (!sub) {
          const enabledStr = config.enabled ? "on" : "OFF";
          const inputStatus = config.input.enabled ? "on" : "off";
          const outputLevel = output.getLevel();
          const provider = ctx.model?.provider ?? "unknown";
          const ttl = config.input.providerTTLs[provider] ?? config.input.defaultTTL;
          const cacheLine = !config.input.cacheAware
            ? "off"
            : ttl <= 0
              ? `n/a (${provider})`
              : inputStats.cache.lastCacheAlive
                ? `\u{1F525} warm (${provider}, ${formatDuration(ttl)})`
                : `\u2744 cold  (${provider}, ${formatDuration(ttl)})`;
          ctx.ui.notify(
            [
              "thrift",
              `  enabled: ${enabledStr}`,
              `  input:   ${inputStatus}`,
              `  output:  ${outputLevel}`,
              `  cache:   ${cacheLine}`,
              "",
              "Subcommands: on, off, stats, output, input, ttl, config",
            ].join("\n"),
            "info",
          );
          return;
        }

        // ── stats ───────────────────────────────────────────────────
        if (sub === "stats") {
          const limits = Object.entries(config.input.maxResultBytes)
            .map(([tool, bytes]) => `${tool}=${formatSize(bytes)}`)
            .join(", ");

          const provider = ctx.model?.provider ?? "unknown";
          const ttl = config.input.providerTTLs[provider] ?? config.input.defaultTTL;
          const lastReq = inputStats.cache.lastRequestTime;
          const sinceMs = lastReq > 0 ? Date.now() - lastReq : -1;
          const cacheLine = !config.input.cacheAware
            ? "off (decisions recomputed every call)"
            : ttl <= 0
              ? `n/a (no cache TTL configured for ${provider})`
              : lastReq === 0
                ? `cold (no requests yet, TTL ${formatDuration(ttl)})`
                : sinceMs < ttl
                  ? `🔥 warm (${formatDuration(sinceMs)} since last req, TTL ${formatDuration(ttl)})`
                  : `❄ expired (${formatDuration(sinceMs)} since last req, TTL ${formatDuration(ttl)})`;

          ctx.ui.notify(
            [
              "── thrift stats ──",
              "",
              `  Output level:  ${output.getLevel()}`,
              `  Input pruning: ${config.input.enabled ? "on" : "off"}`,
              "",
              "  Input — source truncation (tool_result):",
              `    ${inputStats.sourceResultsPruned} results truncated`,
              `    ${formatSize(inputStats.sourceBytesSaved)} saved (permanent)`,
              "",
              "  Input — context pruning (per LLM call):",
              `    ${inputStats.lastContextStubbed} stubs on last call`,
              `    ~${formatSize(inputStats.lastContextBytesSaved)} saved on last call`,
              `    ${inputStats.cache.decisions.size} sticky decisions in cache window`,
              "",
              "  Cache awareness:",
              `    Provider:  ${provider}`,
              `    State:     ${cacheLine}`,
              "",
              "  Config:",
              `    Keep recent turns: ${config.input.keepRecentTurns}`,
              `    Stub threshold:    ${formatSize(config.input.stubThresholdBytes)}`,
              `    Source limits:     ${limits}`,
              `    File: ~/.pi/agent/thrift.json`,
            ].join("\n"),
            "info",
          );
          return;
        }

        // ── ttl [on|off|<duration>] ────────────────────────────────
        if (sub === "ttl") {
          const provider = ctx.model?.provider ?? "unknown";
          const ttl = config.input.providerTTLs[provider] ?? config.input.defaultTTL;
          const lastReq = inputStats.cache.lastRequestTime;
          const sinceMs = lastReq > 0 ? Date.now() - lastReq : -1;

          if (!arg) {
            // Status only
            const lines = [
              "── cache-aware TTL ──",
              "",
              `  Cache aware:   ${config.input.cacheAware ? "on" : "off"}`,
              `  Active provider: ${provider}`,
              `  TTL for provider: ${formatDuration(ttl)}${ttl <= 0 ? " (disabled)" : ""}`,
              `  Default TTL:   ${formatDuration(config.input.defaultTTL)}`,
              `  Last request:  ${lastReq === 0 ? "never" : `${formatDuration(sinceMs)} ago`}`,
              `  Cache state:   ${inputStats.cache.lastCacheAlive ? "🔥 warm" : "❄ cold"}`,
              `  Sticky decisions: ${inputStats.cache.decisions.size}`,
              "",
              "  Usage:",
              "    /tp ttl on|off          Toggle cache-aware stubbing",
              "    /tp ttl <duration>      Set default TTL (e.g. 5m, 30s, 1h, 0 to disable)",
              "    /tp ttl reset           Clear sticky decisions and last-request timestamp",
            ];
            ctx.ui.notify(lines.join("\n"), "info");
            return;
          }

          if (arg === "on" || arg === "off") {
            config.input.cacheAware = arg === "on";
            await saveConfig(config);
            ctx.ui.notify(`Cache-aware stubbing ${arg}.`, "info");
            return;
          }

          if (arg === "reset" || arg === "clear") {
            inputStats.cache.decisions.clear();
            inputStats.cache.lastRequestTime = 0;
            inputStats.cache.lastCacheAlive = false;
            ctx.ui.notify("Cache-aware state reset.", "info");
            return;
          }

          const parsed = parseDuration(arg);
          if (parsed === null || parsed < 0) {
            ctx.ui.notify(
              `Invalid TTL: "${arg}". Use on/off, reset, or a duration like 5m, 30s, 1h, 0.`,
              "error",
            );
            return;
          }
          config.input.defaultTTL = parsed;
          await saveConfig(config);
          ctx.ui.notify(
            `Default TTL set to ${formatDuration(parsed)}${parsed === 0 ? " (cache-aware disabled by default)" : ""}.`,
            "info",
          );
          return;
        }

        // ── output [level|stop] ─────────────────────────────────────
        if (sub === "output") {
          let newLevel: OutputLevel;

          if (!arg) {
            // Toggle
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
          pi.appendEntry(OUTPUT_LEVEL_ENTRY, { level: newLevel });
          output.syncStatus(ctx);

          ctx.ui.notify(
            newLevel === "off" ? "Output pruning off." : `Output: terse ${newLevel}`,
            "info",
          );
          return;
        }

        // ── input [on|off] ──────────────────────────────────────────
        if (sub === "input") {
          if (!arg) {
            config.input.enabled = !config.input.enabled;
          } else if (arg === "on") {
            config.input.enabled = true;
          } else if (arg === "off") {
            config.input.enabled = false;
          } else {
            ctx.ui.notify(`Unknown: "${arg}". Use: on, off`, "error");
            return;
          }

          if (!config.input.enabled) {
            ctx.ui.setStatus("thrift", "");
          }

          ctx.ui.notify(`Input pruning ${config.input.enabled ? "on" : "off"}.`, "info");
          return;
        }

        // ── config ──────────────────────────────────────────────────
        if (sub === "config") {
          await output.openConfig(ctx);
          return;
        }

        // ── Unknown subcommand ──────────────────────────────────────
        ctx.ui.notify(
          `Unknown subcommand: "${sub}". Use: on, off, stats, output, input, ttl, config`,
          "error",
        );
      },
    });
  }

  // Register both the full name and the short alias
  registerNamespacedCommand("thrift");
  registerNamespacedCommand("tp");
}
