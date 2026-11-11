import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { syncSpecMarkdownFromJson } from "../artifacts/spec-markdown.js";
import { type AccordTrailer, buildCommitMessage } from "../commit/commit-grammar.js";
import { commitWithMessage, git, gitRoot } from "../git/helpers.js";
import { readJson, writeJson } from "../work-items/io.js";
import { amendMarkerPath, lockedPaths, writeContractLock } from "./lock.js";

export interface ContractAmendInput {
  diff: string;
  reason: string;
  affected_acs: string[];
}

export interface ContractAmendResult {
  ok: boolean;
  hash?: string;
  stale_task_ids?: number[];
  reason?: string;
}

interface AmendmentRecord {
  diff: string;
  reason: string;
  affected_acs: string[];
  stale_task_ids: number[];
  at: string;
}

export async function applyContractAmend(
  workItemId: string,
  input: ContractAmendInput,
  cwd: string,
): Promise<ContractAmendResult> {
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason) return { ok: false, reason: "contract amend requires a reason" };

  const root = await gitRoot(cwd);
  const base = `docs/dev/${workItemId}`;
  const lockRel = `${base}/contract.lock.json`;
  const lockAbs = join(root, lockRel);
  const specAbs = join(root, base, "spec.json");

  const plan = readJson<{ tasks?: Array<{ id: number; covers_ac?: string[] }> }>(
    join(root, base, "plan.json"),
  );
  const affected = new Set(input.affected_acs);
  const staleTaskIds = (plan?.tasks ?? [])
    .filter((task) => (task.covers_ac ?? []).some((ac) => affected.has(ac)))
    .map((task) => task.id);

  const previous = readJson<{ amendments?: AmendmentRecord[] }>(lockAbs);
  const amendments = [...(previous?.amendments ?? [])];
  const synced = syncSpecMarkdownFromJson(specAbs);
  if (!synced.ok) return { ok: false, reason: String(synced.error) };

  const lock = await writeContractLock(workItemId, root);
  amendments.push({
    diff: input.diff,
    reason,
    affected_acs: [...input.affected_acs],
    stale_task_ids: staleTaskIds,
    at: new Date().toISOString(),
  });
  writeJson(lockAbs, { ...lock, amendments });

  const specMdRel = `${base}/spec.md`;
  const owned = [
    ...lockedPaths(workItemId),
    ...(existsSync(join(root, specMdRel)) ? [specMdRel] : []),
    lockRel,
  ];
  try {
    const staged = (await git(["diff", "--cached", "--name-only"], root))
      .split("\n")
      .filter((file) => file && !owned.includes(file));
    for (const file of staged) await git(["restore", "--staged", "--", file], root);
    const trailer: AccordTrailer = {
      v: 1,
      id: workItemId,
      task: 0,
      seq: amendments.length,
      ref: "contract-amend",
      agent: "harness",
      loop: "amend",
      round: 0,
      outcome: "amend",
      ac: input.affected_acs,
    };
    const summary = `amend contract: ${reason.replace(/\s+/g, " ")}`;
    const { hash } = await commitWithMessage(root, owned, buildCommitMessage({ summary, trailer }));
    rmSync(amendMarkerPath(workItemId, root), { force: true });
    return { ok: true, hash, stale_task_ids: staleTaskIds };
  } catch (error) {
    return {
      ok: false,
      reason: `contract amend commit failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
