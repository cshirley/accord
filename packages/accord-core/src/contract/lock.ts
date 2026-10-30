import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "../git/helpers.js";
import { readJson, writeJson } from "../work-items/io.js";
import { resolveTasksDir } from "../work-items/tasks-dir.js";

export interface ContractLockVerification {
  unchanged: boolean;
  changed: string[];
}

interface ContractLock {
  schema_version: "1.0";
  work_item_id: string;
  preceding_commit: string;
  files: Record<string, string>;
}

const sha256 = (data: string): string => createHash("sha256").update(data).digest("hex");

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  return value;
}

function hashLockedFile(relPath: string, cwd: string): string {
  const raw = readFileSync(join(cwd, relPath), "utf8");
  if (!relPath.endsWith("/plan.json")) return sha256(raw);
  const { guidance: _guidance, ...rest } = JSON.parse(raw) as Record<string, unknown>;
  return sha256(JSON.stringify(canonicalize(rest)));
}

function lockPath(workItemId: string, cwd: string): string {
  return join(cwd, "docs", "dev", workItemId, "contract.lock.json");
}

export function lockedPaths(workItemId: string): string[] {
  const base = `docs/dev/${workItemId}`;
  return [`${base}/brief.md`, `${base}/spec.json`, `${base}/plan.json`];
}

export function amendMarkerPath(workItemId: string, cwd: string): string {
  return join(cwd, "docs", "dev", workItemId, "state", "contract-amend.open");
}

export async function writeContractLock(workItemId: string, cwd: string): Promise<ContractLock> {
  const files: Record<string, string> = {};
  for (const relPath of lockedPaths(workItemId)) {
    if (!existsSync(join(cwd, relPath))) throw new Error(`locked file missing: ${relPath}`);
    files[relPath] = hashLockedFile(relPath, cwd);
  }
  const precedingCommit = (await git(["rev-parse", "HEAD"], cwd)).trim();
  const lock: ContractLock = {
    schema_version: "1.0",
    work_item_id: workItemId,
    preceding_commit: precedingCommit,
    files,
  };
  writeJson(lockPath(workItemId, cwd), lock);
  return lock;
}

export async function verifyContractLock(
  workItemId: string,
  cwd: string,
): Promise<ContractLockVerification> {
  const lock = readJson<ContractLock>(lockPath(workItemId, cwd));
  if (!lock) throw new Error(`contract.lock.json missing or unreadable for ${workItemId}`);
  const changed: string[] = [];
  for (const relPath of lockedPaths(workItemId)) {
    try {
      if (hashLockedFile(relPath, cwd) !== lock.files?.[relPath]) changed.push(relPath);
    } catch {
      changed.push(relPath);
    }
  }
  return { unchanged: changed.length === 0, changed };
}

export function amendSessionPath(workItemId: string, cwd: string): string {
  return join(resolveTasksDir(workItemId, cwd), `${workItemId}-amend.json`);
}

export function isAmendOpen(workItemId: string, cwd: string): boolean {
  try {
    const session = readJson<{ nonce?: unknown }>(amendSessionPath(workItemId, cwd));
    const nonce = session?.nonce;
    if (typeof nonce !== "string" || nonce === "") return false;
    return readFileSync(amendMarkerPath(workItemId, cwd), "utf8") === nonce;
  } catch {
    return false;
  }
}
