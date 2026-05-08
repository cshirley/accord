/**
 * After subagent tool completes: usage, return packets, post-code verification.
 */

import type { DevHarnessConfig } from "../config/index.js";
import type { PricingConfig } from "../telemetry/usage.js";
import { validateReturn } from "../artifacts/validation.js";
import { runVerificationCommands, formatVerificationResults } from "../crucible/verification.js";
import {
  agentRequiresVerification,
  agentSchemas,
} from "../agents/registry.js";
import {
  type UsageLine,
  extractWorkItemId,
  appendUsageLine,
  computeLineCost,
  updateWorkItemCost,
  extractReturnPacketFromSubagentResult,
  formatPacketInjection,
  formatMissingPacketWarning,
  ensureAutoHarnessRunMeta,
  normalizeUsageCostFields,
} from "../telemetry/usage.js";
import { createLogger } from "../logging.js";
import type { HarnessMutableState } from "./types.js";

const log = createLogger("harness");

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
      const normalized = normalizeUsageCostFields(result.usage as any);
      const billable =
        normalized.input + normalized.output + normalized.cost + normalized.cacheRead + normalized.cacheWrite;
      if (billable > 0) {
        ensureAutoHarnessRunMeta(workItemId);
        host?.syncHarnessRunMeta?.();
        const line: UsageLine = {
          at: new Date().toISOString(),
          work_item_id: workItemId,
          subagent_type: agentName,
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
    const assistantMsgs = msgs.filter((m: any) => m?.role === "assistant");
    const lastAssistant = assistantMsgs[assistantMsgs.length - 1];
    const lastContent = lastAssistant?.content as unknown;
    const hasContent = Array.isArray(lastContent) ? lastContent.length > 0 : !!lastContent;

    if (agentName && !hasContent) {
      const stderrTail =
        typeof result.stderr === "string" ? result.stderr.slice(-300).trim() : "";
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

    const packet = agentName ? extractReturnPacketFromSubagentResult(result as any) : null;
    if (packet) {
      log.info(`agent=${agentName} packet=found status=${(packet as { status?: string }).status}`);
    } else if (agentName) {
      const blockTypes = Array.isArray(lastContent)
        ? lastContent.map((b: any) => b?.type ?? typeof b).join(", ")
        : typeof lastContent;
      log.warn(
        `agent=${agentName} packet=MISSING stopReason=${result.stopReason} blocks=[${blockTypes}] totalMsgs=${msgs.length}`,
      );
    }

    if (packet && agentName) {
      contentAppend += formatPacketInjection(agentName, packet);

      const validation = await validateReturn(agentName, packet);
      if (!validation.valid) {
        contentAppend += [`\n⚠ Return packet validation failed for ${agentName}:`, ...validation.errors.map(e => `  • ${e}`)].join("\n");
      }
    } else if (!packet && agentName && agentSchemas(agentName).some(s => s.startsWith("return-schemas/"))) {
      contentAppend += formatMissingPacketWarning(agentName, Object.keys(result || {}));
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
        contentAppend += formatVerificationResults(vResults, "Post-Code Verification (extension-triggered)");

        if (
          state.devConfig.type_check &&
          vResults.find(r => r.command === state.devConfig!.type_check && r.exitCode !== 0)
        ) {
          contentAppend += "\n\n❌ **Type check failed — this is a hard gate.** Fix the errors shown above.\n";
        }
      }
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
