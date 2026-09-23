/**
 * After validated **phase-verify-acceptance** return — update `wi.verify` and generate `verify.md`.
 *
 * Without this handler, `devVerifySummary` is only called in the core-orchestrator path
 * (`runFinishOrchestrationFromResolution`). The skill-driven path has no automatic trigger,
 * so `verify.md` is never generated unless the skill explicitly calls `dev_verify_summary`.
 * Adding the handler here makes generation automatic in both paths.
 */

import { createLogger } from "../../logging.js";
import { devVerifySummary } from "../../queries/verify-summary.js";
import { loadWorkItem } from "../../work-items/io.js";
import { devTransition } from "../../work-items/lifecycle.js";

const log = createLogger("post-result:phase-verify-acceptance");

interface PhaseVerifyAcceptanceDonePacket {
  status: "done";
  verdict: "pass" | "gaps";
  verify_path: string;
}

function isDonePacket(packet: unknown): packet is PhaseVerifyAcceptanceDonePacket {
  if (!packet || typeof packet !== "object") return false;
  const r = packet as Record<string, unknown>;
  return r.status === "done" && typeof r.verify_path === "string" && r.verify_path.length > 0;
}

export function applyPhaseVerifyAcceptancePostResult(workItemId: string, packet: unknown): string {
  if (!isDonePacket(packet)) return "";

  // Update wi.verify so devVerifySummary (and any later callers) find the file
  // without relying on the conventional-path fallback.
  const wi = loadWorkItem(workItemId);
  const currentPhase = wi?.phase ?? "verified";
  const transition = devTransition(workItemId, currentPhase, { verify: packet.verify_path });
  if (!transition.ok) {
    log.warn(`devTransition failed for ${workItemId}: ${transition.error}`);
  }

  // Generate verify.md from the written verify.json.
  const summary = devVerifySummary(workItemId);
  if (!summary.ok) {
    log.warn(`devVerifySummary failed for ${workItemId}: ${summary.error}`);
    return `\n\n⚠ verify.md generation failed: ${summary.error}\n`;
  }

  log.info(`verify.md written: ${summary.value.markdown_path} (verdict: ${summary.value.verdict})`);
  return "";
}
