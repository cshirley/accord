import { rmSync } from "node:fs";
import { join } from "node:path";
import type { DevHarnessConfig } from "../config/types.js";
import { buildEvidenceAsset, type EvidenceAsset, writeEvidenceAssets } from "../evidence/asset.js";
import { commitWithMessage, extractStatusPaths, git, gitRoot } from "../git/helpers.js";
import { createLogger } from "../logging.js";
import { allocateRef, appendLog, refActor } from "../tasks/model.js";
import { loadTaskV2, mutateTaskV2 } from "../tasks/store.js";
import type { TaskFileV2 } from "../tasks/types.js";
import { emitStackEvent } from "../telemetry/stack-events.js";
import { type AccordTrailer, buildCommitMessage, parseAccordTrailer } from "./commit-grammar.js";
import { guardStagedPaths, guardTrailer } from "./commit-guard.js";

export interface EvidenceCommitResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  hash?: string;
  files?: string[];
}

function hasEvidenceCommit(task: TaskFileV2): boolean {
  return task.log.some(
    (entry) =>
      refActor(entry.ref) === "commit" &&
      entry.result === "committed" &&
      (entry.note ?? "").includes("evidence("),
  );
}

async function nextSeq(root: string, workItemId: string, taskId: number): Promise<number> {
  let max = 0;
  try {
    const out = await git(["log", "--format=%B%x1e"], root);
    for (const message of out.split("\x1e")) {
      try {
        const trailer = parseAccordTrailer(message);
        if (trailer?.id === workItemId && trailer.task === taskId) {
          max = Math.max(max, Number(trailer.seq) || 0);
        }
      } catch {}
    }
  } catch {}
  return max + 1;
}

function rollUp(assets: EvidenceAsset[]): Record<string, number> {
  const out: Record<string, number> = {};
  let roundsTest = 0;
  let roundsCode = 0;
  let findings = 0;
  let est = 0;
  let hasEst = false;
  let act = 0;
  for (const { json } of assets) {
    roundsTest += json.loops.test?.rounds ?? 0;
    roundsCode += json.loops.code?.rounds ?? 0;
    for (const loop of Object.values(json.loops)) {
      findings += loop.findings.crit + loop.findings.warn + loop.findings.sugg;
    }
    if (typeof json.size.est_lines === "number") {
      est += json.size.est_lines;
      hasEst = true;
    }
    act += json.size.act_prod_lines + json.size.act_test_lines;
  }
  out.rounds_test = roundsTest;
  out.rounds_code = roundsCode;
  out.findings_total = findings;
  if (hasEst) out.est_lines = est;
  out.act_lines = act;
  return out;
}

/**
 * Final append-only `evidence(task-<N>[,<M>])` commit for a PR whose tasks are all done.
 * Writes the evidence assets, removes the tasks' state folders and commits only evidence/state
 * paths. Never amends; a rerun after a successful commit is a no-op.
 */
export async function commitTaskEvidence(
  workItemId: string,
  taskIds: number[],
  devConfig: DevHarnessConfig | null | undefined,
  cwd: string,
): Promise<EvidenceCommitResult> {
  if (taskIds.length === 0) return { ok: true, skipped: true, reason: "no tasks" };
  const tasks = taskIds.map((taskId) => loadTaskV2(workItemId, String(taskId)));
  if (tasks.some((task) => task?.control.status !== "done")) {
    return { ok: true, skipped: true, reason: "not every task is done" };
  }
  if (tasks.every((task) => task && hasEvidenceCommit(task))) {
    return { ok: true, skipped: true, reason: "evidence already committed" };
  }

  const ref = `evidence(task-${taskIds.join(",")})`;
  try {
    const root = await gitRoot(cwd);
    const config = devConfig ?? undefined;
    const assets = await buildEvidenceAsset(workItemId, taskIds, { cwd: root, config });
    await writeEvidenceAssets(workItemId, taskIds, { cwd: root, config });

    const devDir = `docs/dev/${workItemId}`;
    for (const taskId of taskIds) {
      rmSync(join(root, devDir, "state", `task-${String(taskId)}`), {
        recursive: true,
        force: true,
      });
    }

    const own = [
      ...taskIds.map((taskId) => `${devDir}/evidence/task-${String(taskId)}.`),
      ...taskIds.map((taskId) => `${devDir}/state/task-${String(taskId)}/`),
    ];
    const statusRaw = await git(["status", "--porcelain", "--untracked-files=all"], root);
    const dirty = extractStatusPaths(statusRaw).filter(
      (file) => file && own.some((prefix) => file.startsWith(prefix)),
    );
    const guarded = guardStagedPaths(
      "evidence",
      workItemId,
      dirty,
      devConfig?.test?.file_pattern ?? "",
      ref,
    );

    const staged = (await git(["diff", "--cached", "--name-only"], root))
      .split("\n")
      .filter(Boolean);
    for (const file of staged) {
      if (!guarded.kept.includes(file)) await git(["restore", "--staged", "--", file], root);
    }

    const firstTask = taskIds[0] as number;
    const trailer: AccordTrailer = {
      v: 1,
      id: workItemId,
      task: firstTask,
      seq: await nextSeq(root, workItemId, firstTask),
      ref,
      agent: "harness",
      loop: "evidence",
      round: 1,
      outcome: "done",
      ...rollUp(assets),
    };
    const trailerGuard = guardTrailer(workItemId, trailer);
    if (!trailerGuard.ok) return { ok: false, reason: trailerGuard.errors.join("; ") };

    const message = buildCommitMessage({ summary: "final evidence", trailer });
    const { hash } = await commitWithMessage(root, guarded.kept, message, undefined, {
      allowEmpty: true,
    });
    for (const taskId of taskIds) {
      mutateTaskV2(workItemId, taskId, (fresh, at) => {
        appendLog(fresh, {
          ref: allocateRef(fresh, "commit"),
          at,
          result: "committed",
          note: `${hash} ${ref} (${String(guarded.kept.length)} file(s))`,
        });
        return true;
      });
    }
    try {
      emitStackEvent("stack.commit.created", {
        work_item_id: workItemId,
        ref,
        outcome: "done",
        sha: hash,
      });
    } catch (emitError) {
      createLogger("commit").warn(
        `stack.commit.created emit failed: ${emitError instanceof Error ? emitError.message : String(emitError)}`,
      );
    }
    return { ok: true, hash, files: guarded.kept };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    createLogger("commit").warn(`evidence commit ${ref} failed: ${reason}`);
    return { ok: false, reason };
  }
}
