/**
 * After subagent tool completes: usage, return packets, post-code verification.
 */

import { agentRequiresVerification, agentSchemas } from "../../agents/registry.js";
import { validateReturn } from "../../artifacts/validation.js";
import { createLogger } from "../../logging.js";
import { runPostResultHandlerForAgent } from "../../orchestration/post-result/registry.js";
import { tryRecoverMissingReturnPacketFromTaskFile } from "../../orchestration/recover-task-packet.js";
import { reconcileCoarsePhaseUntilStable } from "../../orchestration/reconcile-coarse-phase.js";
import { persistValidatedAgentReturn } from "../../orchestration/task-agent-audit.js";
import type { PricingConfig } from "../../telemetry/usage.js";
import {
  appendUsageLine,
  computeLineCost,
  ensureAutoHarnessRunMeta,
  extractTaskIdFromTaskText,
  extractWorkItemId,
  normalizeUsageCostFields,
  type UsageLine,
  updateWorkItemCost,
} from "../../telemetry/usage.js";
import type { HarnessMutableState } from "../../types/host.js";
import { formatVerificationResults, runVerificationCommands } from "../../verification/runner.js";
import { formatMissingPacketWarning, formatPacketInjection } from "./handoff.js";
import {
  extractAnalysisFromSubagentResult,
  extractReturnPacketFromSubagentResult,
} from "./packet.js";

const log = createLogger("subagent");

const COARSE_PHASE_AGENTS = new Set(["phase-align", "phase-spec", "phase-plan"]);

const MISSING_PACKET_RECONCILE_AGENTS = new Set([
  "phase-align",
  "phase-spec",
  "phase-plan",
  "phase-test",
  "phase-code",
  "review-test",
  "review-code",
]);

const REVIEW_AGENTS = new Set(["review-test", "review-code"]);

export interface ProcessSubagentToolResultParams {
  details: unknown;
  state: HarnessMutableState;
  pricing: PricingConfig;
  host?: { syncHarnessRunMeta?: () => void; refreshUi?: () => void };
}

/**
 * Walks `details.results` from a subagent tool_result; updates usage files and state.
 * @returns markdown/text to append to the tool result content for the orchestrator.
 */
export async function processSubagentToolResult(
  params: ProcessSubagentToolResultParams,
): Promise<string> {
  const { details, state, pricing, host } = params;
  const d = details as { results?: unknown[] } | null;
  if (!d?.results || !Array.isArray(d.results)) {
    log.debug(
      `early return — details.results missing or not array. Full details type: ${typeof details}`,
    );
    return "";
  }

  let contentAppend = "";

  // Track distinct billable work items in this batch so we only nudge
  // state.activeWorkItem / sessionCost when there's an unambiguous owner.
  // When the orchestrator dispatches parallel agents across multiple WIs,
  // mutating these per-result lets the last result win and silently drifts
  // attribution for the next orchestrator turn.
  const billableTotals = new Map<string, number>();

  for (const result of d.results as Record<string, unknown>[]) {
    const agentName: string = (result.agent as string) || "";
    const task: string = (result.task as string) || "";
    // Filter against `.tasks/` so an incidental ID token in the task brief
    // (e.g. an example "ACCORD-1234") cannot misattribute usage cost.
    const workItemId = extractWorkItemId(task, { mustExist: true });

    if (workItemId && result.usage) {
      const normalized = normalizeUsageCostFields(result.usage);
      const billable =
        normalized.input +
        normalized.output +
        normalized.cost +
        normalized.cacheRead +
        normalized.cacheWrite;
      if (billable > 0) {
        ensureAutoHarnessRunMeta(workItemId);
        host?.syncHarnessRunMeta?.();
        const taskId = extractTaskIdFromTaskText(task);
        const line: UsageLine = {
          at: new Date().toISOString(),
          work_item_id: workItemId,
          subagent_type: agentName,
          ...(taskId != null ? { task_id: taskId } : {}),
          model: result.model as string | undefined,
          usage: { ...normalized, turns: normalized.turns || 0 },
          source: "subagent",
        };
        appendUsageLine(workItemId, line);
        const cached = state.costCache.get(workItemId) ?? 0;
        const totalCost = cached + computeLineCost(line, pricing);
        state.costCache.set(workItemId, totalCost);
        updateWorkItemCost(workItemId, totalCost);
        billableTotals.set(workItemId, totalCost);
      }
    }

    const msgs = Array.isArray(result.messages) ? result.messages : [];
    const assistantMsgs = msgs.filter(
      (m: unknown) => (m as { role?: string }).role === "assistant",
    );
    const lastAssistant = assistantMsgs[assistantMsgs.length - 1];
    const lastContent = lastAssistant?.content as unknown;
    const hasContent = Array.isArray(lastContent) ? lastContent.length > 0 : !!lastContent;
    const packet = agentName ? extractReturnPacketFromSubagentResult(result) : null;

    if (result.timedOut === true) {
      const timeoutLines = [
        `\n\n❌ **${agentName || "subagent"} timed out before completing.**`,
        ``,
        `The subprocess was stopped by the harness spawn timeout. Increase \`spawnTimeoutMs\` in subagent.json, set \`timeoutMs\` on the tool call, or use \`ACCORD_SUBAGENT_SPAWN_TIMEOUT_MS\` for orchestration defaults.`,
        ``,
        `**Do not respawn ${agentName || "this agent"}** until credentials and timeout are fixed. Run \`dev_subagent_preflight\` with agent="${agentName || "phase-plan"}".`,
      ];
      if (workItemId && agentName && COARSE_PHASE_AGENTS.has(agentName)) {
        const steps = reconcileCoarsePhaseUntilStable(workItemId);
        if (steps > 0) {
          timeoutLines.push(
            ``,
            `✓ Reconciled ${String(steps)} coarse phase step(s) from on-disk artifacts. Run \`/dev resume ${workItemId}\` to continue.`,
          );
        }
      }
      contentAppend += timeoutLines.join("\n");
      continue;
    }

    if (result.aborted === true && !hasContent) {
      contentAppend += [
        `\n\n⚠ **${agentName || "subagent"} was aborted** (user cancel or parent session ended).`,
        result.errorMessage ? `\n- ${String(result.errorMessage)}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      continue;
    }

    if (agentName && !hasContent && !packet) {
      const stderrTail = typeof result.stderr === "string" ? result.stderr.slice(-300).trim() : "";
      log.error(
        `agent=${agentName} EMPTY RESPONSE stopReason=${result.stopReason} exitCode=${result.exitCode} model=${result.model}`,
      );
      if (stderrTail) log.error(`stderr: ${stderrTail}`);
      contentAppend += [
        `\n\n❌ **${agentName} returned an empty response — pipeline cannot continue.**`,
        ``,
        `- model: \`${String(result.model ?? "unknown")}\``,
        `- stopReason: ${String(result.stopReason ?? "unknown")}`,
        `- exitCode: ${String(result.exitCode ?? "unknown")}`,
        stderrTail ? `- stderr: ${stderrTail}` : "",
        ``,
        `This usually means the model or provider is not available in the subagent process.`,
        `Check that the model is configured for a direct provider (e.g. Anthropic, Google) rather than a host-only provider (e.g. cursor-agent).`,
        ``,
        `**Stop the pipeline. Do not retry without fixing the model configuration.**`,
      ]
        .filter(Boolean)
        .join("\n");
      continue;
    }

    if (packet) {
      log.info(`agent=${agentName} packet=found status=${(packet as { status?: string }).status}`);
    } else if (agentName) {
      const blockTypes = Array.isArray(lastContent)
        ? lastContent
            .map((b: unknown) => {
              const block = b as Record<string, unknown>;
              return block?.type ?? typeof b;
            })
            .join(", ")
        : typeof lastContent;
      log.warn(
        `agent=${agentName} packet=MISSING stopReason=${result.stopReason} blocks=[${blockTypes}] totalMsgs=${msgs.length}`,
      );
    }

    if (packet && agentName) {
      contentAppend += formatPacketInjection(agentName, packet);

      const validation = await validateReturn(agentName, packet);
      if (!validation.valid) {
        contentAppend += [
          `\n⚠ Return packet validation failed for ${agentName}:`,
          ...validation.errors.map((e) => `  • ${e}`),
        ].join("\n");
      } else if (workItemId) {
        const analysisText = extractAnalysisFromSubagentResult(result);
        const audit = analysisText ? { analysisText } : undefined;
        persistValidatedAgentReturn(workItemId, agentName, packet, audit);
        contentAppend += runPostResultHandlerForAgent(
          agentName,
          workItemId,
          packet,
          state.devConfig,
        );
      }
    } else if (
      !packet &&
      agentName &&
      agentSchemas(agentName).some((s) => s.startsWith("return-schemas/"))
    ) {
      contentAppend += formatMissingPacketWarning(agentName, Object.keys(result || {}));
      if (workItemId && result.exitCode === 0 && MISSING_PACKET_RECONCILE_AGENTS.has(agentName)) {
        if (COARSE_PHASE_AGENTS.has(agentName)) {
          const steps = reconcileCoarsePhaseUntilStable(workItemId);
          if (steps > 0) {
            contentAppend += [
              "",
              `✓ **${agentName}** wrote a complete artifact on disk — work item coarse phase reconciled (${String(steps)} step(s)).`,
              `Run \`/dev resume ${workItemId}\` to continue — do not respawn ${agentName}.`,
            ].join("\n");
          }
        } else {
          const taskId = extractTaskIdFromTaskText(task);
          const recovered = await tryRecoverMissingReturnPacketFromTaskFile(
            workItemId,
            agentName,
            taskId,
            state.devConfig,
          );
          if (recovered) {
            contentAppend += recovered;
          }
        }
      }
    }

    if (
      packet &&
      state.devConfig &&
      agentRequiresVerification(agentName) &&
      (packet as { status?: string }).status !== "stuck" &&
      (packet as { status?: string }).status !== "blocked"
    ) {
      const commands: string[] = [];
      if (state.devConfig.type_check) commands.push(state.devConfig.type_check);
      if (state.devConfig.test.command.trim()) commands.push(state.devConfig.test.command);

      if (commands.length > 0) {
        const vResults = await runVerificationCommands(commands);
        contentAppend += formatVerificationResults(
          vResults,
          "Post-Code Verification (extension-triggered)",
        );

        if (
          state.devConfig.type_check &&
          vResults.find((r) => r.command === state.devConfig?.type_check && r.exitCode !== 0)
        ) {
          contentAppend +=
            "\n\n❌ **Type check failed — this is a hard gate.** Fix the errors shown above.\n";
        }
      }
    }
  }

  const detailsRecord = details as { mode?: string; results?: unknown[] } | null;
  if (detailsRecord?.mode === "parallel" && Array.isArray(detailsRecord.results)) {
    const timedOutReviews = (detailsRecord.results as Record<string, unknown>[]).filter(
      (r) => r.timedOut === true && REVIEW_AGENTS.has(String(r.agent ?? "")),
    );
    if (timedOutReviews.length >= 2) {
      contentAppend += [
        "",
        "⚠ **Parallel review timed out** for multiple agents.",
        "Re-run **review-test** and **review-code** sequentially (one subagent call each), or scope re-review to changed files only.",
        "Do not retry a full-repo parallel review without increasing `spawnTimeoutMs`.",
      ].join("\n");
    }
  }

  // Only update orchestrator-facing state when this batch unambiguously
  // belongs to a single work item. With two parallel WIs in one subagent
  // call, leave activeWorkItem/sessionCost untouched so the next
  // orchestrator turn doesn't get attributed to whichever result happened
  // to be processed last.
  if (billableTotals.size === 1) {
    const [id, total] = [...billableTotals][0];
    state.activeWorkItem = id;
    state.sessionCost = total;
  }

  host?.refreshUi?.();
  return contentAppend;
}
