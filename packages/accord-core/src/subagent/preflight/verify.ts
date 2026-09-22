/**
 * Before phase-verify-* subagent: staleness + verification_commands gate.
 */

import type { DevHarnessConfig } from "../../config/index.js";
import { extractWorkItemId } from "../../telemetry/usage.js";
import { formatVerificationResults, runVerificationCommands } from "../../verification/runner.js";
import { checkVerifyStaleness } from "../../verification/staleness.js";
import { collectSubagentEntries, type SubagentEntry } from "../entries.js";

/** Verify preflight at tool-start; chain mode gates every `phase-verify*` step. */
function entriesForVerifyPreflight(input: Record<string, unknown>): SubagentEntry[] {
  const chain = input.chain as SubagentEntry[] | undefined;
  if (Array.isArray(chain) && chain.length > 0) {
    return chain.filter((entry) => entry.agent?.startsWith("phase-verify"));
  }
  return collectSubagentEntries(input).filter((entry) => entry.agent?.startsWith("phase-verify"));
}

export async function runVerifyPreflightOnSubagentCall(
  input: Record<string, unknown>,
  devConfig: DevHarnessConfig | null,
): Promise<{ blockReason?: string }> {
  const verifyEntries = entriesForVerifyPreflight(input);
  if (verifyEntries.length === 0) return {};

  let verificationAppendix: string | undefined;

  for (const entry of verifyEntries) {
    const task: string =
      typeof entry.task === "string"
        ? entry.task
        : typeof input.task === "string"
          ? input.task
          : "";
    const workItemId = extractWorkItemId(task);
    if (!workItemId) continue;

    const check = checkVerifyStaleness(workItemId);
    if (!check.ok) {
      return { blockReason: `Verify preflight failed: ${check.reason}` };
    }

    if (devConfig && devConfig.verification_commands.length > 0) {
      if (verificationAppendix === undefined) {
        const results = await runVerificationCommands(devConfig.verification_commands);
        if (results.every((r) => r.exitCode !== 0)) {
          const formatted = formatVerificationResults(
            results,
            "Verify Preflight (all commands failed)",
          );
          return { blockReason: `All verification commands failed.\n${formatted}` };
        }
        verificationAppendix = formatVerificationResults(
          results,
          "Verification Preflight (extension-triggered)",
        );
      }
      if (typeof entry.task === "string") {
        entry.task += verificationAppendix;
      }
    }
  }

  return {};
}
