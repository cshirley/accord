/**
 * After subagent tool completes: usage, return packets, post-code verification.
 */

import { existsSync } from "node:fs";
import { agentRequiresVerification, agentSchemas } from "../../agents/registry.js";
import { listWorkItemTaskIds } from "../../artifacts/trace-artifact.js";
import { validateArtifact, validateReturnQuarantiningEvents } from "../../artifacts/validation.js";
import { applyWorkflowStateFromValidatedReturn } from "../../harness/workflow-state-apply.js";
import { createLogger } from "../../logging.js";
import { commitDoneTasks, formatDoneTaskCommits } from "../../orchestration/commit-on-task-done.js";
import {
  applyInterviewNeedsInputPostResult,
  isNeedsInputPacket,
} from "../../orchestration/post-result/needs-input.js";
import { applyStuckPostResult } from "../../orchestration/post-result/stuck.js";
import { reconcileCoarsePhaseUntilStable } from "../../orchestration/reconcile-coarse-phase.js";
import { tryRecoverMissingReturnPacketFromTaskFile } from "../../orchestration/recover-task-packet.js";
import {
  recordTaskAgentInvalidReturn,
  recordTaskAgentMissingReturn,
  recordTaskAgentReturn,
} from "../../orchestration/task-agent-audit.js";
import { loadTaskV2 } from "../../tasks/store.js";
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
import { loadWorkItem } from "../../work-items/io.js";
import { formatMissingPacketWarning, formatPacketInjection } from "./handoff.js";
import {
  extractAnalysisFromSubagentResult,
  extractReturnPacketFromSubagentResult,
} from "./packet.js";

const log = createLogger("subagent");

const COARSE_PHASE_AGENTS = new Set(["phase-align", "phase-spec", "phase-plan"]);

/** Multi-turn interview agents \u2014 coarse phase to pass to `applyInterviewNeedsInputPostResult`. */
const INTERVIEW_COARSE_PHASE_BY_AGENT: Readonly<Record<string, string>> = {
  "phase-align": "aligning",
  "phase-spec": "speccing",
  "phase-plan": "planning",
};

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

/**
 * Task id of the single task whose in-flight spawn is `agentName` — attributes usage when the
 * brief carries no `task_id` (older brief formats, parallel spawns).
 */
function inFlightTaskIdForAgent(workItemId: string, agentName: string): number | null {
  const matches = listWorkItemTaskIds(workItemId, loadWorkItem(workItemId)).filter(
    (taskId) => loadTaskV2(workItemId, taskId)?.control.in_flight?.agent === agentName,
  );
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

/**
 * Agents that write a schema-governed artifact and report its path in the return packet.
 * Subagents write outside the host's write/edit hooks, so the artifact is validated here.
 */
const RETURNED_ARTIFACT_PATH_FIELD: Readonly<Record<string, string>> = {
  "phase-spec": "spec_path",
  "phase-plan": "plan_path",
  "phase-verify-acceptance": "verify_path",
};

/** Schema errors for the artifact a `done` packet points at, or `[]` when valid / not applicable. */
async function validateReturnedArtifact(agentName: string, packet: unknown): Promise<string[]> {
  const field = RETURNED_ARTIFACT_PATH_FIELD[agentName];
  if (!field || !packet || typeof packet !== "object") return [];
  const record = packet as Record<string, unknown>;
  const artifactPath = record[field];
  if (record.status !== "done" || typeof artifactPath !== "string" || !artifactPath) return [];
  if (!existsSync(artifactPath)) return [];
  const result = await validateArtifact(artifactPath);
  return result.valid ? [] : result.errors.map((error) => `${artifactPath}: ${error}`);
}

function packetHasValidUsage(packet: Record<string, unknown>): boolean {
  const usage = packet.usage;
  if (!usage || typeof usage !== "object") return false;
  const u = usage as Record<string, unknown>;
  return typeof u.prompt_tokens === "number" && typeof u.completion_tokens === "number";
}

/**
 * Every return-schema requires the agent to self-report `usage.{prompt_tokens,completion_tokens}`,
 * but the host already measures real token usage per spawn (`result.usage`). Models
 * occasionally drop the self-reported field despite instructions; when that happens, fill it
 * from the host measurement instead of failing validation and stranding the phase on a
 * misleading "needs_input" (there is nothing for the user to answer \u2014 the agent's own work is fine).
 */
function backfillPacketUsageFromHostMeasurement(
  packet: Record<string, unknown>,
  hostUsage: unknown,
  agentName: string,
  logger: { debug: (msg: string) => void },
): void {
  if (packetHasValidUsage(packet) || !hostUsage) return;
  const normalized = normalizeUsageCostFields(hostUsage);
  if (normalized.input === 0 && normalized.output === 0) return;
  packet.usage = { prompt_tokens: normalized.input, completion_tokens: normalized.output };
  logger.debug(`agent=${agentName} backfilled packet.usage from host-measured result.usage`);
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      const b = block as { type?: string; text?: unknown };
      return b?.type === "text" && typeof b.text === "string" ? b.text : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

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
  /** Work items seen in this batch — swept for done-but-uncommitted tasks afterwards. */
  const touchedWorkItems = new Set<string>();

  for (const result of d.results as Record<string, unknown>[]) {
    const agentName: string = (result.agent as string) || "";
    const task: string = (result.task as string) || "";
    // Filter against `.tasks/` so an incidental ID token in the task brief
    // (e.g. an example "ACCORD-1234") cannot misattribute usage cost.
    const workItemId = extractWorkItemId(task, { mustExist: true });
    if (workItemId) touchedWorkItems.add(workItemId);

    // Every spawn attributed to a work item is logged — including retries, re-runs, failures,
    // and timeouts. A spawn without a usage block is still recorded (`usage_missing`) so the
    // call shows up in workflow-cost reporting instead of disappearing.
    if (workItemId && agentName) {
      // Host-measured usage first; fall back to the agent's self-reported packet `usage`.
      const hostUsage = normalizeUsageCostFields(result.usage ?? {});
      const hostBillable =
        hostUsage.input +
        hostUsage.output +
        hostUsage.cost +
        hostUsage.cacheRead +
        hostUsage.cacheWrite;
      const selfReported =
        hostBillable === 0
          ? (extractReturnPacketFromSubagentResult(result) as { usage?: unknown } | null)?.usage
          : undefined;
      const normalized = selfReported ? normalizeUsageCostFields(selfReported) : hostUsage;
      const billable =
        normalized.input +
        normalized.output +
        normalized.cost +
        normalized.cacheRead +
        normalized.cacheWrite;
      ensureAutoHarnessRunMeta(workItemId);
      host?.syncHarnessRunMeta?.();
      const taskId =
        extractTaskIdFromTaskText(task) ?? inFlightTaskIdForAgent(workItemId, agentName);
      const exitCode = typeof result.exitCode === "number" ? result.exitCode : null;
      const line: UsageLine = {
        at: new Date().toISOString(),
        work_item_id: workItemId,
        subagent_type: agentName,
        ...(taskId != null ? { task_id: taskId } : {}),
        model: result.model as string | undefined,
        usage: { ...normalized, turns: normalized.turns || 0 },
        source: "subagent",
        ...(billable === 0 ? { usage_missing: true } : {}),
        ...(selfReported && billable > 0 ? { usage_self_reported: true } : {}),
        ...(exitCode !== null && exitCode !== 0 ? { exit_code: exitCode } : {}),
        ...(result.timedOut === true ? { timed_out: true } : {}),
      };
      appendUsageLine(workItemId, line);
      const cached = state.costCache.get(workItemId) ?? 0;
      const totalCost = cached + computeLineCost(line, pricing);
      state.costCache.set(workItemId, totalCost);
      updateWorkItemCost(workItemId, totalCost);
      billableTotals.set(workItemId, totalCost);
    }

    const msgs = Array.isArray(result.messages) ? result.messages : [];
    const assistantMsgs = msgs.filter(
      (m: unknown) => (m as { role?: string }).role === "assistant",
    );
    const lastAssistant = assistantMsgs[assistantMsgs.length - 1];
    const lastContent = lastAssistant?.content as unknown;
    const resultRecord = result as Record<string, unknown>;
    const outputText = typeof resultRecord.output === "string" ? resultRecord.output.trim() : "";
    const streamedText = (() => {
      const live = resultRecord.liveActivity as { streamingText?: string } | undefined;
      return typeof live?.streamingText === "string" ? live.streamingText.trim() : "";
    })();
    const hasAssistantBlocks = Array.isArray(lastContent) ? lastContent.length > 0 : !!lastContent;
    const hasContent = hasAssistantBlocks || outputText.length > 0 || streamedText.length > 0;
    const packet = agentName ? extractReturnPacketFromSubagentResult(result) : null;

    // Text the agent produced, for persisting when no valid packet lands.
    const producedText = [outputText, streamedText, textFromContent(lastContent)].find(
      (text) => text.length > 0,
    );

    if (result.timedOut === true) {
      const partialSidecar =
        workItemId && agentName && producedText
          ? recordTaskAgentMissingReturn(workItemId, agentName, producedText)
          : null;
      const timeoutLines = [
        `\n\n❌ **${agentName || "subagent"} timed out before completing.**`,
        ``,
        `The subprocess was stopped by the harness spawn timeout. Increase \`spawnTimeoutMs\` in subagent.json, set \`timeoutMs\` on the tool call, or use \`ACCORD_SUBAGENT_SPAWN_TIMEOUT_MS\` for orchestration defaults.`,
        ``,
        `**Do not respawn ${agentName || "this agent"}** until credentials and timeout are fixed. Run \`dev_subagent_preflight\` with agent="${agentName || "phase-plan"}".`,
        ...(partialSidecar
          ? [``, `Partial output saved to task sidecar \`${partialSidecar}\`.`]
          : []),
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
      if (workItemId && COARSE_PHASE_AGENTS.has(agentName) && result.exitCode === 0) {
        const steps = reconcileCoarsePhaseUntilStable(workItemId);
        if (steps > 0) {
          contentAppend += [
            ``,
            `✓ **${agentName}** wrote a complete artifact on disk — work item coarse phase reconciled (${String(steps)} step(s)).`,
            `Run \`/dev resume ${workItemId}\` to continue — do not respawn ${agentName}.`,
          ].join("\n");
          continue;
        }
      }

      const stderrTail = typeof result.stderr === "string" ? result.stderr.slice(-300).trim() : "";
      const usage = result.usage as { output?: number } | undefined;
      const billedOutput = typeof usage?.output === "number" ? usage.output : 0;
      log.error(
        `agent=${agentName} EMPTY RESPONSE stopReason=${result.stopReason} exitCode=${result.exitCode} model=${result.model} billedOutputTokens=${String(billedOutput)}`,
      );
      if (stderrTail) log.error(`stderr: ${stderrTail}`);
      const billedHint =
        billedOutput > 0
          ? `The subagent billed ~${String(billedOutput)} output tokens but returned no harvestable text or return packet. If using \`cursor\`, set \`hideThinkingBlock\` to \`false\` in Pi settings or ensure the agent ends with a \`\`\`json return block.`
          : `This usually means the model or provider is not available in the subagent process. Check credentials (\`dev_subagent_preflight\`) and that the model profile matches your API keys.`;
      contentAppend += [
        `\n\n❌ **${agentName} returned an empty response — pipeline cannot continue.**`,
        ``,
        `- model: \`${String(result.model ?? "unknown")}\``,
        `- stopReason: ${String(result.stopReason ?? "unknown")}`,
        `- exitCode: ${String(result.exitCode ?? "unknown")}`,
        billedOutput > 0 ? `- output tokens: ${String(billedOutput)}` : "",
        stderrTail ? `- stderr: ${stderrTail}` : "",
        ``,
        billedHint,
        ``,
        `**Stop the pipeline. Do not retry until output or on-disk artifacts are fixed.**`,
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
      backfillPacketUsageFromHostMeasurement(packet, result.usage, agentName, log);
      contentAppend += formatPacketInjection(agentName, packet);

      // Every agent's `stuck` shape (question/context/tried) is uniform \u2014 promote it to
      // decisions[] regardless of agent or whether the rest of the packet validates, so a
      // stuck agent is never silently lost.
      if (workItemId) {
        contentAppend += applyStuckPostResult(workItemId, agentName, packet);
      }

      // Persist the raw packet BEFORE validation so it survives an invalid packet or a crash
      // between receive and apply. Flagged `validated: false` until validation passes, so
      // crash recovery never applies an unchecked packet.
      const analysis = extractAnalysisFromSubagentResult(result);
      if (workItemId) {
        recordTaskAgentReturn(workItemId, agentName, packet, analysis, { validated: false });
      }

      const validation = await validateReturnQuarantiningEvents(agentName, packet);
      if (validation.valid) {
        const artifactErrors = await validateReturnedArtifact(agentName, packet);
        if (artifactErrors.length > 0) {
          validation.valid = false;
          validation.errors = [...validation.errors, ...artifactErrors];
        }
      }
      if (validation.droppedEvents.length > 0) {
        contentAppend += [
          `\n⚠ Dropped ${String(validation.droppedEvents.length)} malformed \`events[]\` entr${validation.droppedEvents.length === 1 ? "y" : "ies"} from the ${agentName} packet (kept in the task sidecar):`,
          ...validation.droppedEvents.map((e) => `  • ${JSON.stringify(e).slice(0, 200)}`),
        ].join("\n");
      }
      if (!validation.valid) {
        contentAppend += [
          `\n⚠ Return packet validation failed for ${agentName}:`,
          ...validation.errors.map((e) => `  • ${e}`),
        ].join("\n");
        if (workItemId) {
          const invalidRef = recordTaskAgentInvalidReturn(
            workItemId,
            agentName,
            packet,
            validation.errors,
            analysis,
          );
          if (invalidRef) {
            contentAppend += `\n\nRaw packet saved and run logged as \`${invalidRef}\` (invalid_packet). \`/dev resume ${workItemId}\` respawns ${agentName}.`;
          }
        }
        // Never silently drop a genuine needs_input question set behind an unrelated schema
        // error (e.g. a missing/malformed field elsewhere in the packet) — those questions are
        // user-facing state that must land in decisions[]/checkpoint regardless.
        const interviewCoarsePhase = INTERVIEW_COARSE_PHASE_BY_AGENT[agentName];
        if (workItemId && interviewCoarsePhase && isNeedsInputPacket(packet)) {
          contentAppend += applyInterviewNeedsInputPostResult(
            workItemId,
            agentName,
            interviewCoarsePhase,
            packet,
          );
        }
      } else if (workItemId) {
        contentAppend += applyWorkflowStateFromValidatedReturn({
          workItemId,
          agent: agentName,
          packet,
          devConfig: state.devConfig,
          subagentResult: result,
          ...(validation.droppedEvents.length ? { droppedEvents: validation.droppedEvents } : {}),
        });
      }
    } else if (
      !packet &&
      agentName &&
      agentSchemas(agentName).some((s) => s.startsWith("return-schemas/"))
    ) {
      contentAppend += formatMissingPacketWarning(agentName, Object.keys(result || {}));
      if (workItemId && producedText) {
        const saved = recordTaskAgentMissingReturn(workItemId, agentName, producedText);
        if (saved) contentAppend += `\nAgent output saved to task sidecar \`${saved}\`.`;
      }
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

  // Every task that reached `done` gets a commit: sweep after the batch so tasks finished by
  // this result, by a human unblock, or whose earlier commit failed are all committed.
  for (const touchedId of touchedWorkItems) {
    try {
      contentAppend += formatDoneTaskCommits(
        await commitDoneTasks(touchedId, state.devConfig, process.cwd()),
      );
    } catch (e) {
      log.warn(
        `task commit sweep failed for ${touchedId}: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  host?.refreshUi?.();
  return contentAppend;
}
