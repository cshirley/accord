import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { parseAccordTrailer } from "@clive.shirley/accord-core/commit/commit-grammar.js";
import { hashLocked, lockedPaths } from "@clive.shirley/accord-core/contract/lock.js";
import type { EvidenceContext, EvidenceRule, RuleOutcome } from "../evidence-check.js";

const execFileAsync = promisify(execFile);
const GUARDED = /^docs\/dev\/([^/]+)\/(brief\.md|spec\.json|plan\.json|contract\.lock\.json)$/;
const LOCK_FILE = /^docs\/dev\/([^/]+)\/contract\.lock\.json$/;
const MAX_BUFFER = 256 * 1024 * 1024;

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: MAX_BUFFER });
  return stdout;
}

async function gitOrNull(args: string[], cwd: string): Promise<string | null> {
  try {
    return await git(args, cwd);
  } catch {
    return null;
  }
}

const lines = (text: string): string[] => text.split("\n").filter((line) => line !== "");

async function changedPaths(commit: string, cwd: string): Promise<string[]> {
  const parents = lines(await git(["rev-list", "--parents", "-n", "1", commit], cwd))
    .join(" ")
    .split(" ")
    .slice(1);
  if (parents.length <= 1) {
    return lines(
      await git(
        ["diff-tree", "-r", "--no-renames", "--name-only", "--no-commit-id", "--root", commit],
        cwd,
      ),
    );
  }
  const perParent = await Promise.all(
    parents.map(async (parent) =>
      lines(await git(["diff-tree", "-r", "--no-renames", "--name-only", parent, commit], cwd)),
    ),
  );
  const [first = [], ...rest] = perParent;
  return first.filter((path) => rest.every((other) => other.includes(path)));
}

interface LockRecord {
  files?: Record<string, string>;
  amendments?: unknown[];
}

async function lockAt(commit: string, id: string, cwd: string): Promise<LockRecord | null> {
  const raw = await gitOrNull(["show", `${commit}:docs/dev/${id}/contract.lock.json`], cwd);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" ? (parsed as LockRecord) : null;
  } catch {
    return null;
  }
}

function isAmendFor(message: string, id: string): boolean {
  try {
    const trailer = parseAccordTrailer(message);
    return trailer?.outcome === "amend" && trailer.id === id;
  } catch {
    return false;
  }
}

async function hashAt(commit: string, rel: string, cwd: string): Promise<string | null> {
  const content = await gitOrNull(["show", `${commit}:${rel}`], cwd);
  if (content === null) return null;
  const dir = mkdtempSync(join(tmpdir(), "contract-lock-"));
  try {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), content);
    return hashLocked(rel, dir);
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function lockedHashesMatch(commit: string, id: string, cwd: string): Promise<boolean> {
  const lock = await lockAt(commit, id, cwd);
  if (!lock?.files) return false;
  for (const rel of lockedPaths(id)) {
    const hash = await hashAt(commit, rel, cwd);
    if (hash === null || hash !== lock.files[rel]) return false;
  }
  return true;
}

function amendScope(id: string): (path: string) => boolean {
  const base = `docs/dev/${id}/`;
  const allowed = new Set([...lockedPaths(id), `${base}spec.md`, `${base}contract.lock.json`]);
  return (path) => allowed.has(path) || path.startsWith(`${base}state/`);
}

async function amendProblems(
  commit: string,
  id: string,
  touched: string[],
  changed: string[],
  cwd: string,
): Promise<string[]> {
  const inScope = amendScope(id);
  const outside = changed.filter((path) => !inScope(path) && !GUARDED.test(path));
  const otherLocked = changed.filter((path) => GUARDED.test(path) && !inScope(path));
  if (outside.length > 0 || otherLocked.length > 0) {
    return [...outside, ...otherLocked].map(
      (path) => `${path}: outside the scope of amend commit ${commit.slice(0, 12)}`,
    );
  }
  const before = await lockAt(`${commit}^`, id, cwd);
  const after = await lockAt(commit, id, cwd);
  const grew = (after?.amendments?.length ?? 0) > (before?.amendments?.length ?? 0);
  if (grew && (await lockedHashesMatch(commit, id, cwd))) return [];
  const names = touched.filter((path) => !LOCK_FILE.test(path));
  return (names.length > 0 ? names : touched).map(
    (path) =>
      `${path}: amend commit ${commit.slice(0, 12)} lacks a matching lock and amendment record`,
  );
}

export function createContractLockRule(cwd: string = process.cwd()): EvidenceRule {
  return { name: "contract-lock", run: (ctx) => runContractLock(ctx, cwd) };
}

async function runContractLock(ctx: EvidenceContext, cwd: string): Promise<RuleOutcome> {
  const base = (await gitOrNull(["rev-parse", "--verify", `${ctx.base}^{commit}`], cwd))?.trim();
  const head = (await gitOrNull(["rev-parse", "--verify", `${ctx.head}^{commit}`], cwd))?.trim();
  if (!base) return { ok: false, message: `cannot resolve base ${ctx.base}` };
  if (!head) return { ok: false, message: `cannot resolve head ${ctx.head}` };

  const trusted = new Map<string, LockRecord | null>();
  for (const path of lines((await gitOrNull(["ls-tree", "-r", "--name-only", base], cwd)) ?? "")) {
    const id = LOCK_FILE.exec(path)?.[1];
    if (id) trusted.set(id, await lockAt(base, id, cwd));
  }

  const commits = lines(
    await git(["rev-list", "--reverse", "--topo-order", `${base}..${head}`], cwd),
  );
  const problems: string[] = [];
  for (const commit of commits) {
    const changed = await changedPaths(commit, cwd);
    const byId = new Map<string, string[]>();
    for (const path of changed) {
      const id = GUARDED.exec(path)?.[1];
      if (id) byId.set(id, [...(byId.get(id) ?? []), path]);
    }
    if (byId.size === 0) continue;
    const message = await git(["log", "-1", "--format=%B", commit], cwd);
    for (const [id, touched] of byId) {
      if (!trusted.has(id)) {
        if (touched.includes(`docs/dev/${id}/contract.lock.json`)) {
          const added = await lockAt(commit, id, cwd);
          if (added) trusted.set(id, added);
        }
        continue;
      }
      if (isAmendFor(message, id)) {
        const amendIssues = await amendProblems(commit, id, touched, changed, cwd);
        problems.push(...amendIssues);
        if (amendIssues.length === 0) trusted.set(id, await lockAt(commit, id, cwd));
        continue;
      }
      for (const path of touched) {
        const expected = trusted.get(id)?.files?.[path];
        const unchanged = expected !== undefined && (await hashAt(commit, path, cwd)) === expected;
        if (!unchanged) {
          problems.push(
            `${path}: changed in ${commit.slice(0, 12)} without a contract-amend commit`,
          );
        }
      }
    }
  }
  return problems.length === 0 ? { ok: true } : { ok: false, message: problems.join("; ") };
}
