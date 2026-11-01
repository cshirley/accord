import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { git } from "../git/helpers.js";
import { emitStackEvent } from "../telemetry/stack-events.js";
import {
  amendMarkerPath,
  hashLocked,
  isAmendOpen,
  lockedPaths,
  trustedContractLock,
} from "./lock.js";

const AMEND_AGENTS = new Set(["phase-spec", "phase-plan"]);

export interface AfterSpawnResult {
  restored: string[];
}

/**
 * Restores contract-locked files a spawn changed outside an authorised amend, from the trusted
 * lock commit, and emits stack.guard.rejected for each. No-op for work items that were never locked.
 */
export async function verifyAfterSpawn(
  workItemId: string,
  cwd: string,
  agent = "",
): Promise<AfterSpawnResult> {
  const trusted = await trustedContractLock(workItemId, cwd);
  if (!trusted) return { restored: [] };
  const root = (await git(["rev-parse", "--show-toplevel"], cwd)).trim();

  const open = isAmendOpen(workItemId, root);
  const marker = amendMarkerPath(workItemId, root);
  if (!open && existsSync(marker)) rmSync(marker, { force: true });
  const authorised = open && AMEND_AGENTS.has(agent);

  const offending: string[] = [];
  if (!authorised) {
    for (const relPath of lockedPaths(workItemId)) {
      try {
        if (hashLocked(relPath, root) !== trusted.lock.files?.[relPath]) offending.push(relPath);
      } catch {
        offending.push(relPath);
      }
    }
  }
  const lockRel = `docs/dev/${workItemId}/contract.lock.json`;
  try {
    if (readFileSync(join(root, lockRel), "utf8").trim() !== trusted.raw.trim()) {
      offending.push(lockRel);
    }
  } catch {
    offending.push(lockRel);
  }
  if (offending.length === 0) return { restored: [] };

  await git(["checkout", trusted.commit, "--", ...offending], root);
  for (const path of offending) {
    emitStackEvent("stack.guard.rejected", {
      work_item_id: workItemId,
      ref: "contract-lock",
      rule: "locked-file-written",
      path,
    });
  }
  return { restored: offending };
}
