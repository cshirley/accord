import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { allocateRef, appendLog } from "../tasks/model.js";
import { mutateTaskV2 } from "../tasks/store.js";
import { loadWorkItem, now, readJson, workItemJsonPath, writeJson } from "../work-items/io.js";
import { resolveTasksDir } from "../work-items/tasks-dir.js";
import { applyContractAmend } from "./amend.js";
import {
  amendMarkerPath,
  amendSessionPath,
  type ContractLock,
  hashLocked,
  isAmendOpen,
} from "./lock.js";

export interface OpenAmendInput {
  reason: string;
  replan: boolean;
}

export type OpenAmendResult = { ok: true; nonce: string } | { ok: false; reason: string };

export interface AmendSession {
  nonce: string;
  reason: string;
  replan: boolean;
}

const SNAPSHOT_FILES = ["spec.json", "plan.json"] as const;

function snapshotDir(workItemId: string, cwd: string): string {
  return join(resolveTasksDir(workItemId, cwd), `${workItemId}-amend`);
}

export function readAmendSession(workItemId: string, cwd: string): AmendSession | null {
  if (!isAmendOpen(workItemId, cwd)) return null;
  const session = readJson<Partial<AmendSession>>(amendSessionPath(workItemId, cwd));
  if (!session || typeof session.nonce !== "string") return null;
  return {
    nonce: session.nonce,
    reason: typeof session.reason === "string" ? session.reason : "",
    replan: session.replan === true,
  };
}

export function openAmend(workItemId: string, input: OpenAmendInput, cwd: string): OpenAmendResult {
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason) return { ok: false, reason: "contract amend requires a reason" };

  const existing = readAmendSession(workItemId, cwd);
  if (existing) {
    const session: AmendSession = { nonce: existing.nonce, reason, replan: input.replan };
    writeJson(amendSessionPath(workItemId, cwd), session);
    return { ok: true, nonce: existing.nonce };
  }

  const base = `docs/dev/${workItemId}`;
  const lock = readJson<ContractLock>(join(cwd, base, "contract.lock.json"));
  if (!lock) return { ok: false, reason: "contract.lock.json missing or unreadable" };
  for (const file of SNAPSHOT_FILES) {
    const rel = `${base}/${file}`;
    try {
      if (hashLocked(rel, cwd) !== lock.files?.[rel]) {
        return { ok: false, reason: `${rel} differs from the contract lock` };
      }
    } catch {
      return { ok: false, reason: `${rel} missing or unreadable` };
    }
  }

  const snapshot = snapshotDir(workItemId, cwd);
  mkdirSync(snapshot, { recursive: true });
  for (const file of SNAPSHOT_FILES) {
    writeFileSync(join(snapshot, file), readFileSync(join(cwd, base, file)));
  }
  const nonce = randomBytes(16).toString("hex");
  const marker = amendMarkerPath(workItemId, cwd);
  mkdirSync(dirname(marker), { recursive: true });
  writeFileSync(marker, nonce);
  writeJson(amendSessionPath(workItemId, cwd), {
    nonce,
    reason,
    replan: input.replan,
  } satisfies AmendSession);
  return { ok: true, nonce };
}

export function closeAmend(workItemId: string, cwd: string): void {
  rmSync(amendMarkerPath(workItemId, cwd), { force: true });
  rmSync(snapshotDir(workItemId, cwd), { recursive: true, force: true });
  rmSync(amendSessionPath(workItemId, cwd), { force: true });
}

export function cancelAmend(workItemId: string, cwd: string): void {
  closeAmend(workItemId, cwd);
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

type SpecAcs = Map<string, unknown>;

function acsOf(path: string): SpecAcs {
  const spec = readJson<{ acceptance_criteria?: Array<{ id?: unknown }> }>(path);
  const acs: SpecAcs = new Map();
  for (const ac of spec?.acceptance_criteria ?? []) {
    if (typeof ac?.id === "string") acs.set(ac.id, ac);
  }
  return acs;
}

function specPaths(workItemId: string, cwd: string): { old: SpecAcs; current: SpecAcs } | null {
  const snapshotSpec = join(snapshotDir(workItemId, cwd), "spec.json");
  if (!existsSync(snapshotSpec)) return null;
  return {
    old: acsOf(snapshotSpec),
    current: acsOf(join(cwd, "docs", "dev", workItemId, "spec.json")),
  };
}

export function affectedAcsFromSpecDiff(workItemId: string, cwd: string): string[] {
  const specs = specPaths(workItemId, cwd);
  if (!specs) return [];
  const ids = new Set([...specs.old.keys(), ...specs.current.keys()]);
  return [...ids]
    .filter((id) => {
      const before = specs.old.get(id);
      const after = specs.current.get(id);
      return before === undefined || after === undefined || stable(before) !== stable(after);
    })
    .sort();
}

/** Human-readable before/after of each affected AC, stored in the lock amendment record. */
export function specDiffText(workItemId: string, cwd: string, affected: string[]): string {
  const specs = specPaths(workItemId, cwd);
  if (!specs) return "";
  return affected
    .flatMap((id) => {
      const before = specs.old.get(id);
      const after = specs.current.get(id);
      return [
        `@@ ${id}`,
        ...(before === undefined ? [] : [`- ${JSON.stringify(before)}`]),
        ...(after === undefined ? [] : [`+ ${JSON.stringify(after)}`]),
      ];
    })
    .join("\n");
}

export const STALE_AFTER_AMEND = "stale after contract-amend";

const AMEND_AGENTS = new Set(["phase-spec", "phase-plan"]);

function blockStaleTasks(workItemId: string, taskIds: number[]): void {
  for (const taskId of taskIds) {
    mutateTaskV2(workItemId, taskId, (task, at) => {
      if (task.control.status === "done" || task.control.status === "blocked") return false;
      const ref = allocateRef(task, "amend");
      appendLog(task, { ref, at, result: "blocked", note: STALE_AFTER_AMEND, actor: "human" });
      task.control.status = "blocked";
      task.control.blocked = { kind: "manual", reason: STALE_AFTER_AMEND, ref };
      return true;
    });
  }
}

function setCoarsePhase(workItemId: string, phase: string): void {
  const workItem = loadWorkItem(workItemId);
  if (!workItem) return;
  (workItem as { phase: string }).phase = phase;
  workItem.updated = now();
  writeJson(workItemJsonPath(workItemId), workItem);
}

/**
 * Called after a validated phase agent return. Returns a handoff note, or null when no amend is
 * open for this agent. `stuck` closes the amend; the last amended `done` commits it.
 */
export async function advanceAmendAfterPhase(
  workItemId: string,
  agent: string,
  status: unknown,
  cwd: string,
): Promise<string | null> {
  if (!AMEND_AGENTS.has(agent)) return null;
  const session = readAmendSession(workItemId, cwd);
  if (!session) return null;
  if (status === "stuck") {
    closeAmend(workItemId, cwd);
    return `\n\n**Contract amend cancelled:** ${agent} stuck.`;
  }
  if (status !== "done") return null;
  if (agent === "phase-spec" && session.replan) return null;

  const affected = affectedAcsFromSpecDiff(workItemId, cwd);
  const diff = specDiffText(workItemId, cwd, affected);
  const result = await applyContractAmend(
    workItemId,
    { diff, reason: session.reason, affected_acs: affected },
    cwd,
  );
  if (!result.ok) {
    return `\n\n**Contract amend failed:** ${result.reason ?? "unknown error"}`;
  }
  closeAmend(workItemId, cwd);
  blockStaleTasks(workItemId, result.stale_task_ids ?? []);
  setCoarsePhase(workItemId, "implementing");
  const stale = result.stale_task_ids ?? [];
  return `\n\n**Contract amend:** \`${result.hash}\` (${affected.join(", ") || "no AC changes"}); blocked stale tasks: ${stale.join(", ") || "none"}.`;
}
