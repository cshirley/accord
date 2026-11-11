import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { findGitRoot } from "../config/git.js";
import { normalizeHarnessRelativePath } from "../harness/paths.js";
import { emitStackEvent } from "../telemetry/stack-events.js";
import { isAmendOpen } from "./lock.js";

const LOCKED_FILES = new Set(["brief.md", "spec.json", "plan.json"]);
const ORCHESTRATOR_ONLY = new Set(["contract.lock.json", "state/contract-amend.open"]);

/** Block reason for a write/edit of a contract-locked file, or null when the write may proceed. */
export function contractLockToolCallBlock(
  toolName: string,
  input: unknown,
  cwd: string,
): string | null {
  if (toolName !== "write" && toolName !== "edit") return null;
  if (typeof input !== "object" || input === null) return null;
  const rawPath = (input as { path?: unknown }).path;
  if (typeof rawPath !== "string" || rawPath === "") return null;

  const stripped = rawPath.replace(/^@/, "");
  const absolute = isAbsolute(stripped) ? resolve(stripped) : resolve(cwd, stripped);
  const normalized = normalizeHarnessRelativePath(absolute.split("\\").join("/"));
  const match = /(?:^|\/)docs\/dev\/([^/]+)\/(.+)$/.exec(normalized);
  if (!match) return null;
  const [, workItemId, rest] = match as unknown as [string, string, string];
  const orchestratorOnly = ORCHESTRATOR_ONLY.has(rest);
  if (!orchestratorOnly && !LOCKED_FILES.has(rest)) return null;

  const gitRoot = findGitRoot(cwd);
  const roots = gitRoot && gitRoot !== cwd ? [cwd, gitRoot] : [cwd];
  const root = roots.find((candidate) =>
    existsSync(join(candidate, "docs", "dev", workItemId, "contract.lock.json")),
  );
  if (!root) return null;
  if (!orchestratorOnly && isAmendOpen(workItemId, root)) return null;

  const relative = `docs/dev/${workItemId}/${rest}`;
  emitStackEvent("stack.guard.rejected", {
    work_item_id: workItemId,
    ref: "contract-lock",
    rule: orchestratorOnly ? "orchestrator-only" : "locked-file",
    path: relative,
  });
  return orchestratorOnly
    ? `${relative} is locked for ${workItemId}: only the orchestrator writes it during contract-amend.`
    : `${relative} is locked for ${workItemId}: open a contract-amend before changing it.`;
}
