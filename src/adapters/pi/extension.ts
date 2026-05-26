/**
 * ACCORD Extension for Pi — entry point.
 *
 * Wires together three concerns:
 *   1. /dev command   — deterministic routing + core orchestrator spawns + free-text intent preflight (`classifyPreflight`)
 *   2. Tools          — orchestrator functions exposed to the LLM
 *   3. Hooks          — event handlers for validation, verification, usage, etc.
 *
 * See docs/concepts.md for the architecture overview and docs/pipeline.md
 * for the full agentic flow diagrams. README.md is the entry point.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";
import { classifyPreflight } from "../../core/commands/classify-dispatch.js";
import {
  devDispatch,
  parseHarnessTagArgs,
  parseKnownDevSubcommandArgs,
} from "../../core/commands/dispatch.js";
import { DEV_HELP_TEXT } from "../../core/commands/help.js";
import {
  getDevSubcommandOwner,
  isPlanModeReadOnlyDevSubcommand,
} from "../../core/commands/subcommand-routing.js";
import { loadDevHarnessConfig } from "../../core/config/index.js";
import { maybeAutoInstallAssets } from "../../core/harness/asset-bootstrap.js";
import { createLogger, resolveLogLevel, setLogLevel } from "../../core/logging.js";
import { devTasks } from "../../core/queries/dashboard.js";
import { devRetro } from "../../core/queries/retro.js";
import { devReviewQueue } from "../../core/queries/review-queue.js";
import { devSpecGaps } from "../../core/queries/spec-gaps.js";
import {
  clearHarnessRunTag,
  describeHarnessRunMeta,
  setHarnessRunTag,
} from "../../core/telemetry/usage.js";
import { devRehydrateWorkItem } from "../../core/work-items/rehydrate.js";
import { getSubagentToolRenderers } from "../../integrations/pi-subagent.js";
import { getDevArgumentCompletions, wrapDevAutocomplete } from "./command/autocomplete.js";
import { tryFinishViaCoreOrchestrator } from "./finish-orchestration.js";
import { type HookState, syncHarnessRunSessionEntry } from "./hook-state.js";
import { registerPiHarnessHookListeners } from "./pi-hook-listeners.js";
import { isPlanModeActive, planModeBlockMessage } from "./plan-mode.js";
import { registerOrchestratorSubagentChatRenderer } from "./subagent/chat-display.js";
import { registerTools } from "./tools.js";
import {
  ORCHESTRATOR_DISABLED_MESSAGE,
  tryClassifyFollowUpViaCoreOrchestrator,
  tryDevSubcommandViaCoreOrchestrator,
} from "./workflow-orchestration.js";

const extensionLog = createLogger("extension");

function isReadOnlyDevRoute(route: ReturnType<typeof devDispatch>): boolean {
  if (route.type === "empty") return true;
  return route.type === "known" && isPlanModeReadOnlyDevSubcommand(route.subcommand);
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

  const commandHandler = async (
    args: string,
    ctx: import("@earendil-works/pi-coding-agent").ExtensionCommandContext,
  ) => {
    const route = devDispatch(args);

    if (isPlanModeActive(ctx) && !isReadOnlyDevRoute(route)) {
      ctx.ui.notify(planModeBlockMessage(), "warning");
      return;
    }

    if (route.type === "empty") {
      const r = route.route;
      if (r.route === "help") {
        ctx.ui.notify(DEV_HELP_TEXT, "info");
        return;
      }
      if (r.route === "suggest_resume") {
        ctx.ui.notify(
          `Active: ${r.id} — ${r.title} (phase: ${r.phase})\n\nRun /accord resume ${r.id} to continue.`,
          "info",
        );
        return;
      }
      if (r.route === "dashboard") {
        ctx.ui.notify(r.formatted, "info");
        return;
      }
    }

    if (route.type === "known" && route.subcommand === "help") {
      ctx.ui.notify(DEV_HELP_TEXT, "info");
      return;
    }
    if (route.type === "known" && route.subcommand === "tasks") {
      ctx.ui.notify(devTasks().formatted, "info");
      return;
    }
    if (route.type === "known" && route.subcommand === "retro") {
      const result = devRetro();
      ctx.ui.notify(result.ok ? result.value.formatted : result.error, "info");
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
        ctx.ui.notify(
          "Usage: `/accord tag <label>` or `/accord tag --new <label>` — label is required after `--new`.",
          "warning",
        );
        return;
      }
      try {
        state._harnessSessionMarkerFp = null;
        const meta = setHarnessRunTag(parsed.label, { newRunId: parsed.newRunId });
        syncHarnessRunSessionEntry(pi, state);
        const hint = parsed.newRunId ? "(new run_id)" : "";
        ctx.ui.notify(
          `ACCORD run ${hint}\n  tag: ${meta.tag}\n  run_id: ${meta.run_id}\n\nUsage rows in .tasks/*-usage.jsonl include harness_run_id / harness_session_tag.\nPi session transcript includes a dev-harness-run marker for session review compatibility.`,
          "info",
        );
      } catch (e: unknown) {
        ctx.ui.notify(e instanceof Error ? e.message : String(e), "error");
      }
      return;
    }

    if (route.type === "known" && route.subcommand === "rehydrate") {
      const parsed = parseKnownDevSubcommandArgs("rehydrate", route.args);
      const workItemId = parsed.leadingWorkItemId;
      if (!workItemId) {
        ctx.ui.notify("Usage: `/dev rehydrate <work-item-id>`", "warning");
        return;
      }
      const result = devRehydrateWorkItem(workItemId);
      if (!result.ok) {
        ctx.ui.notify(result.error, "error");
        return;
      }
      ctx.ui.notify(result.value.message, "info");
      return;
    }

    if (route.type === "known" && route.subcommand === "init") {
      ctx.ui.notify(
        "ACCORD init runs in this session (not a separate skill). Follow the numbered flow using `dev_init_detect` and `dev_init_write`. See docs/configuration.md.",
        "info",
      );
      pi.sendUserMessage(
        [
          "[ACCORD init]",
          "Run the harness init flow in this session:",
          "1. Call `dev_init_detect` (cwd inferred).",
          "2. Confirm placement and fields with the user; patch proposed_config as needed.",
          "3. Call `dev_init_write` with final config, target, cwd, and git_root when required.",
          "Do not spawn phase agents until init completes.",
        ].join("\n"),
        { deliverAs: "followUp" },
      );
      return;
    }

    if (route.type === "known" && route.subcommand === "spec-gaps") {
      const parsed = parseKnownDevSubcommandArgs("spec-gaps", route.args);
      const workItemId = parsed.leadingWorkItemId;
      if (!workItemId) {
        ctx.ui.notify("Usage: `/dev spec-gaps <work-item-id>`", "warning");
        return;
      }
      const result = devSpecGaps(workItemId);
      ctx.ui.notify(
        result.ok ? result.value.formatted : result.error,
        result.ok ? "info" : "error",
      );
      return;
    }

    if (route.type === "known" && route.subcommand === "review") {
      ctx.ui.notify(devReviewQueue().formatted, "info");
      ctx.ui.notify(
        "Drain pending items with the appropriate `review-*` subagent when action is required.",
        "info",
      );
      return;
    }

    if (route.type === "known" && getDevSubcommandOwner(route.subcommand) === "core_orchestrator") {
      if (route.subcommand === "finish") {
        const finishOutcome = await tryFinishViaCoreOrchestrator(route.args, pi, ctx, state);
        if (finishOutcome === "forward") {
          ctx.ui.notify(ORCHESTRATOR_DISABLED_MESSAGE, "warning");
        }
        return;
      }

      const orchOutcome = await tryDevSubcommandViaCoreOrchestrator(
        route.subcommand,
        route.args,
        pi,
        ctx,
        state,
      );
      if (orchOutcome === "orchestrator_disabled") {
        ctx.ui.notify(ORCHESTRATOR_DISABLED_MESSAGE, "warning");
      }
      return;
    }

    if (route.type === "classify") {
      const pre = classifyPreflight(route.text);
      ctx.ui.notify(pre.intentBlock, "info");
      if (pre.bootstrapNotice) ctx.ui.notify(pre.bootstrapNotice, "info");

      const followUp = await tryClassifyFollowUpViaCoreOrchestrator(route.text, pi, ctx, state);
      if (followUp === "orchestrator_disabled") {
        ctx.ui.notify(ORCHESTRATOR_DISABLED_MESSAGE, "warning");
        return;
      }
      if (followUp === "handled") {
        return;
      }

      pi.sendUserMessage(
        [
          "[ACCORD classify]",
          pre.intentBlock,
          pre.bootstrapNotice ? `\n${pre.bootstrapNotice}` : "",
          "",
          "Continue in this session: call `dev_intent` / `dev_bootstrap` / `dev_resume_state` as needed, then use the `subagent` tool for phase agents. Run `/dev resume <ID>` when the work item exists on disk.",
        ].join("\n"),
        { deliverAs: "followUp" },
      );
      return;
    }

    ctx.ui.notify("Unknown /dev route. Run `/dev help`.", "warning");
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
  registerPiHarnessHookListeners(pi, state);
  registerOrchestratorSubagentChatRenderer(pi, getSubagentToolRenderers() ?? {});
}
