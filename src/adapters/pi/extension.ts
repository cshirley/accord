/**
 * ACCORD Extension for Pi — entry point.
 *
 * Wires together three concerns:
 *   1. /dev command   — deterministic routing + LLM fallback
 *   2. Tools          — orchestrator functions exposed to the LLM
 *   3. Hooks          — event handlers for validation, verification, usage, etc.
 *
 * See docs/concepts.md for the architecture overview and docs/pipeline.md
 * for the full agentic flow diagrams. README.md is the entry point.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import { loadDevHarnessConfig } from "../../core/config/index.js";
import { createLogger, resolveLogLevel, setLogLevel } from "../../core/logging.js";
import { registerTools } from "./tools.js";
import { registerHooks } from "./hooks.js";
import { syncHarnessRunSessionEntry, type HookState } from "./hook-state.js";
import { isPlanModeActive, planModeBlockMessage } from "./plan-mode.js";
import { devDispatch, parseHarnessTagArgs } from "../../core/commands/dispatch.js";
import { maybeAutoInstallAssets } from "../../core/harness/asset-bootstrap.js";
import {
  clearHarnessRunTag,
  describeHarnessRunMeta,
  setHarnessRunTag,
} from "../../core/telemetry/usage.js";
import { devTasks } from "../../core/queries/dashboard.js";
import { devRetro } from "../../core/queries/retro.js";
import { DEV_HELP_TEXT } from "../../core/commands/help.js";
import { getDevArgumentCompletions, wrapDevAutocomplete } from "./command/autocomplete.js";

const extensionLog = createLogger("extension");

function isReadOnlyDevRoute(route: ReturnType<typeof devDispatch>): boolean {
  if (route.type === "empty") return true;
  return route.type === "known" && ["help", "tasks", "retro"].includes(route.subcommand);
}

export default function (pi: ExtensionAPI) {
  // Shared mutable state — hooks and tools both read/write this
  const config = loadDevHarnessConfig();
  setLogLevel(resolveLogLevel(config?.log_level));

  const state: HookState = {
    devConfig: config,
    sessionCost: 0,
    activeWorkItem: null,
    _harnessSessionMarkerFp: null,
    costCache: new Map(),
  };

  // ── /dev and /accord commands (deterministic routing) ───────────────

  const commandHandler = async (args: string, ctx: import("@mariozechner/pi-coding-agent").ExtensionCommandContext) => {
    const route = devDispatch(args);

    if (isPlanModeActive(ctx) && !isReadOnlyDevRoute(route)) {
      ctx.ui.notify(planModeBlockMessage(), "warning");
      return;
    }

    if (route.type === "empty") {
      const r = route.route;
      if (r.route === "help") { ctx.ui.notify(DEV_HELP_TEXT, "info"); return; }
      if (r.route === "suggest_resume") {
        ctx.ui.notify(`Active: ${r.id} — ${r.title} (phase: ${r.phase})\n\nRun /accord resume ${r.id} to continue.`, "info");
        return;
      }
      if (r.route === "dashboard") { ctx.ui.notify(r.formatted, "info"); return; }
    }

    if (route.type === "known" && route.subcommand === "help") { ctx.ui.notify(DEV_HELP_TEXT, "info"); return; }
    if (route.type === "known" && route.subcommand === "tasks") { ctx.ui.notify(devTasks().formatted, "info"); return; }
    if (route.type === "known" && route.subcommand === "retro") {
      const result = devRetro();
      ctx.ui.notify("error" in result ? result.error : result.formatted, "info");
      return;
    }

    if (route.type === "known" && route.subcommand === "tag") {
      const parsed = parseHarnessTagArgs(route.args);
      if (parsed.mode === "show") {
        ctx.ui.notify(describeHarnessRunMeta(), "info");
        return;
      }
      if (parsed.mode === "clear") {
        clearHarnessRunTag();
        state._harnessSessionMarkerFp = null;
        ctx.ui.notify("ACCORD run tag cleared (.tasks/.harness-run.json removed).", "info");
        return;
      }
      if (!parsed.label.trim()) {
        ctx.ui.notify('Usage: `/accord tag <label>` or `/accord tag --new <label>` — label is required after `--new`.', "warning");
        return;
      }
      try {
        state._harnessSessionMarkerFp = null;
        const meta = setHarnessRunTag(parsed.label, { newRunId: parsed.newRunId });
        syncHarnessRunSessionEntry(pi, state);
        const hint = parsed.newRunId ? "(new run_id)" : "";
        ctx.ui.notify(`ACCORD run ${hint}\n  tag: ${meta.tag}\n  run_id: ${meta.run_id}\n\nUsage rows in .tasks/*-usage.jsonl include harness_run_id / harness_session_tag.\nPi session transcript includes a dev-harness-run marker for session review compatibility.`, "info");
      } catch (e: unknown) {
        ctx.ui.notify(e instanceof Error ? e.message : String(e), "error");
      }
      return;
    }

    // Everything else → forward to the skill for LLM handling
    const trimmed = args.trim();
    pi.sendUserMessage(trimmed ? `/skill:accord ${trimmed}` : "/skill:accord", { deliverAs: "followUp" });
  };

  const commandCompletions = (prefix: string): AutocompleteItem[] | null => {
    return getDevArgumentCompletions(prefix);
  };

  pi.registerCommand("accord", {
    description: "ACCORD harness — /accord help for usage",
    getArgumentCompletions: commandCompletions,
    handler: commandHandler,
  });

  pi.registerCommand("dev", {
    description: "ACCORD harness (alias) — /accord help for usage",
    getArgumentCompletions: commandCompletions,
    handler: commandHandler,
  });

  pi.on("session_start", (_event, ctx) => {
    ctx.ui.addAutocompleteProvider(wrapDevAutocomplete);
    // Auto-link bundled Pi assets if they're missing or stale. Notifies
    // the user when a restart is required to activate freshly linked
    // skills/agents/providers (Pi only scans those dirs at startup).
    // Set ACCORD_AUTO_INSTALL_ASSETS=false to opt out.
    try {
      maybeAutoInstallAssets({
        notify: (level, message) => ctx.ui.notify(message, level),
      });
    } catch (e) {
      extensionLog.warn(
        `session_start: asset bootstrap notify failed (${e instanceof Error ? e.message : String(e)})`,
      );
    }
  });

  // ── Tools + Hooks ──────────────────────────────────────

  registerTools(pi, () => state.devConfig);
  registerHooks(pi, state);
}
