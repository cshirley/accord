/**
 * Before phase-verify-* subagent: staleness + verification_commands gate.
 */

import type { DevHarnessConfig } from "../config/index.js";
import { extractWorkItemId } from "../telemetry/usage.js";
import { formatVerificationResults, runVerificationCommands } from "../verification/runner.js";
import { checkVerifyStaleness } from "../verification/staleness.js";
import { firstSubagentAgentName, getPrimarySubagentEntry } from "./subagent-entries.js";

export async function runVerifyPreflightOnSubagentCall(
  input: Record<string, unknown>,
  devConfig: DevHarnessConfig | null,
): Promise<{ blockReason?: string }> {
  const agentName = firstSubagentAgentName(input);
  if (!agentName.startsWith("phase-verify")) return {};

  const entry = getPrimarySubagentEntry(input);
  const task: string =
    typeof entry?.task === "string" ? entry.task : typeof input.task === "string" ? input.task : "";
  // Use the unfiltered extractor: when a phase-verify-* agent is dispatched
  // for a missing/typo'd work-item ID, the staleness check below produces a
  // clearer block message ("Spec not found: docs/dev/<ID>/spec.json") than
  // the silent no-op we'd get with mustExist:true.
  const workItemId = extractWorkItemId(task);
  if (!workItemId) return {};

  const check = checkVerifyStaleness(workItemId);
  if (!check.ok) {
    return { blockReason: `Verify preflight failed: ${check.reason}` };
  }

  if (devConfig && devConfig.verification_commands.length > 0) {
    const results = await runVerificationCommands(devConfig.verification_commands);
    if (results.every((r) => r.exitCode !== 0)) {
      const formatted = formatVerificationResults(
        results,
        "Verify Preflight (all commands failed)",
      );
      return { blockReason: `All verification commands failed.\n${formatted}` };
    }
    const formatted = formatVerificationResults(
      results,
      "Verification Preflight (extension-triggered)",
    );
    if (entry && typeof entry.task === "string") {
      entry.task += formatted;
    }
  }

  return {};
}
