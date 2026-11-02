import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parseAccordTrailer } from "@clive.shirley/accord-core/commit/commit-grammar.js";
import type { EvidenceContext, EvidenceRule, RuleOutcome } from "../evidence-check.js";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 256 * 1024 * 1024;
const STATE_PATH = /^docs\/dev\/([^/]+)\/state\/(.+)$/;
const CLOSEOUT_MARKER = /^docs\/dev\/([^/]+)\/evidence\/closeout\.json$/;
const TASK_DIR = /^task-(\d+)(?:\/|$)/;
const EVIDENCE_REF = /^evidence\(task-(\d+(?:,\d+)*)\)$/;
const COMMIT_END = "\u0001";

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: MAX_BUFFER });
  return stdout;
}

async function resolveCommit(rev: string, cwd: string): Promise<string | null> {
  try {
    return (await git(["rev-parse", "--verify", `${rev}^{commit}`], cwd)).trim();
  } catch {
    return null;
  }
}

interface History {
  closedOut: Set<string>;
  evidenced: Map<string, Set<string>>;
}

async function readHistory(head: string, cwd: string): Promise<History> {
  const closedOut = new Set<string>();
  const evidenced = new Map<string, Set<string>>();
  const log = await git(["log", `--format=%B${COMMIT_END}`, head], cwd);
  for (const message of log.split(COMMIT_END)) {
    let trailer: ReturnType<typeof parseAccordTrailer>;
    try {
      trailer = parseAccordTrailer(message);
    } catch {
      continue;
    }
    if (!trailer) continue;
    if (trailer.outcome === "closeout") closedOut.add(trailer.id);
    const tasks = EVIDENCE_REF.exec(trailer.ref)?.[1];
    if (tasks) {
      const set = evidenced.get(trailer.id) ?? new Set<string>();
      for (const task of tasks.split(",")) set.add(task);
      evidenced.set(trailer.id, set);
    }
  }
  return { closedOut, evidenced };
}

async function runLeftoverState(ctx: EvidenceContext, cwd: string): Promise<RuleOutcome> {
  const base = await resolveCommit(ctx.base, cwd);
  const head = await resolveCommit(ctx.head, cwd);
  if (!base) return { ok: false, message: `cannot resolve base ${ctx.base}` };
  if (!head) return { ok: false, message: `cannot resolve head ${ctx.head}` };

  const paths = (await git(["ls-tree", "-r", "--name-only", head, "--", "docs/dev"], cwd))
    .split("\n")
    .filter((path) => path !== "");
  const stateByItem = new Map<string, string[]>();
  const markers = new Set<string>();
  for (const path of paths) {
    const marker = CLOSEOUT_MARKER.exec(path)?.[1];
    if (marker) markers.add(marker);
    const match = STATE_PATH.exec(path);
    if (match?.[1] && match[2]) {
      stateByItem.set(match[1], [...(stateByItem.get(match[1]) ?? []), match[2]]);
    }
  }
  if (stateByItem.size === 0) return { ok: true };

  const history = await readHistory(head, cwd);
  const problems: string[] = [];
  for (const [id, entries] of [...stateByItem].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const root = `docs/dev/${id}/state`;
    if (markers.has(id) || history.closedOut.has(id)) {
      problems.push(`${root}: remains after closeout of ${id}`);
      continue;
    }
    const done = history.evidenced.get(id);
    if (!done) continue;
    const tasks = new Set<string>();
    for (const entry of entries) {
      const task = TASK_DIR.exec(entry)?.[1];
      if (task && done.has(task)) tasks.add(task);
    }
    for (const task of [...tasks].sort((left, right) => Number(left) - Number(right))) {
      problems.push(`${root}/task-${task}: remains after evidence(task-${task})`);
    }
  }
  return problems.length === 0 ? { ok: true } : { ok: false, message: problems.join("; ") };
}

export function createLeftoverStateRule(cwd: string = process.cwd()): EvidenceRule {
  return { name: "leftover-state", run: (ctx) => runLeftoverState(ctx, cwd) };
}
