import { join } from "node:path";
import { resolveStackConfig } from "../config/stack-flags.js";
import type { DevHarnessConfig } from "../config/types.js";
import { git } from "../git/helpers.js";
import { mutateJson, now, readJson } from "../work-items/io.js";
import { workItemJsonPath } from "../work-items/tasks-dir.js";
import type { WorkItem } from "../work-items/types.js";
import { computeStack } from "./compute-stack.js";
import { resolveStackProvider, type StackPr, type StackProvider } from "./provider.js";
import { stackSubmit } from "./service.js";
import type { StackPlanTask } from "./types.js";

export interface AdvanceStackOptions {
  cwd?: string;
  provider?: StackProvider;
}

export interface AdvanceStackResult {
  ok: boolean;
  text: string;
}

const MAIN = "main";
const MAIN_REF = `origin/${MAIN}`;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function succeeds(args: string[], cwd: string): Promise<boolean> {
  try {
    await git(args, cwd);
    return true;
  } catch {
    return false;
  }
}

/** Blob ids of `paths` at `ref`; a path absent at `ref` has no entry. Null when the ref is unreadable. */
async function blobIds(
  ref: string,
  paths: string[],
  cwd: string,
): Promise<Map<string, string> | null> {
  try {
    const out = await git(["ls-tree", "-r", "-z", ref, "--", ...paths], cwd);
    const ids = new Map<string, string>();
    for (const line of out.split("\0")) {
      const match = /^\d+ blob ([0-9a-f]+)\t([\s\S]+)$/.exec(line);
      if (match) ids.set(match[2] as string, match[1] as string);
    }
    return ids;
  } catch {
    return null;
  }
}

function raiseDecision(workItemId: string, cwd: string, pr: StackPr, paths: string[]): void {
  const prefix = `bottom-up-pr-${String(pr.number)}`;
  const listed = paths.length > 0 ? paths.join(", ") : "(no conflicted path)";
  mutateJson<WorkItem>(workItemJsonPath(workItemId, cwd), (wi) => {
    if (!wi) return undefined;
    wi.decisions ??= [];
    const same = wi.decisions.filter(
      (decision) => decision.id === prefix || decision.id.startsWith(`${prefix}-`),
    );
    if (same.some((decision) => decision.status === "pending")) return undefined;
    const id = same.length === 0 ? prefix : `${prefix}-${String(same.length + 1)}`;
    const at = now();
    wi.decisions.push({
      id,
      source: "escalation",
      status: "pending",
      question: `Merging ${MAIN} into ${pr.head} (PR #${String(pr.number)}) conflicts on ${listed}, and ${MAIN} differs from the merged base PR head, so no rule can resolve it. Resolve it by hand and push, or amend the plan.`,
      context: `The advance stopped before any change was kept: the merge was aborted, nothing was pushed, and PR #${String(pr.number)} still targets ${pr.base}.`,
      phase: "implementing",
      asked_at: at,
    });
    wi.updated = at;
    return wi;
  });
}

/**
 * Squash add/add rule: a conflicted path keeps the child's version only when main's content equals
 * the base PR head's. All paths resolve or none does; returns the paths that could not be resolved.
 */
async function resolveConflicts(base: string, cwd: string): Promise<string[]> {
  const conflicted = (await git(["diff", "--name-only", "-z", "--diff-filter=U"], cwd))
    .split("\0")
    .filter((path) => path.length > 0);
  if (conflicted.length === 0) return [];
  const mainIds = await blobIds(MAIN_REF, conflicted, cwd);
  const baseIds =
    (await blobIds(`refs/remotes/origin/${base}`, conflicted, cwd)) ??
    (await blobIds(`refs/heads/${base}`, conflicted, cwd));
  const unresolved = conflicted.filter((path) => {
    const mainId = mainIds?.get(path);
    return mainId === undefined || mainId !== baseIds?.get(path);
  });
  if (unresolved.length > 0) return unresolved;
  try {
    await git(["checkout", "--ours", "--", ...conflicted], cwd);
    await git(["add", "--", ...conflicted], cwd);
    return [];
  } catch {
    return conflicted;
  }
}

async function hasMerge(cwd: string): Promise<boolean> {
  return succeeds(["rev-parse", "-q", "--verify", "MERGE_HEAD"], cwd);
}

/** Head of each task PR's parent PR (highest-index dependency), from the plan. */
function parentHeads(
  workItemId: string,
  cwd: string,
  sizing: ReturnType<typeof resolveStackConfig>["sizing"],
): Map<string, string> {
  const parents = new Map<string, string>();
  try {
    const plan = readJson<{ tasks: StackPlanTask[] }>(
      join(cwd, "docs", "dev", workItemId, "plan.json"),
    );
    if (!plan || !Array.isArray(plan.tasks)) return parents;
    const taskPrs = computeStack(plan, sizing).prs.filter((group) => group.kind === "task");
    const headOf = new Map(
      taskPrs.map((group) => [group.index, `accord/${workItemId}/task-${group.tasks[0]}`]),
    );
    for (const group of taskPrs) {
      const parent = Math.max(...(group.depends_on_prs ?? []).filter((index) => headOf.has(index)));
      if (Number.isFinite(parent))
        parents.set(headOf.get(group.index) as string, headOf.get(parent) as string);
    }
  } catch {
    return new Map();
  }
  return parents;
}

type Step = { ok: true } | { ok: false; text: string };

async function advanceOne(
  workItemId: string,
  cwd: string,
  pr: StackPr,
  baseHead: string,
  provider: StackProvider,
): Promise<Step> {
  await git(["checkout", "--quiet", pr.head], cwd);
  try {
    await git(["merge", "--no-commit", "--no-ff", MAIN_REF], cwd);
  } catch (error) {
    const unresolved = await resolveConflicts(baseHead, cwd).catch(() => null);
    if (unresolved === null || (unresolved.length === 0 && !(await hasMerge(cwd)))) {
      await git(["merge", "--abort"], cwd).catch(() => undefined);
      return { ok: false, text: `Merge failed: ${errorText(error)}` };
    }
    if (unresolved.length > 0) {
      await git(["merge", "--abort"], cwd).catch(() => undefined);
      raiseDecision(workItemId, cwd, pr, unresolved);
      return {
        ok: false,
        text: `Advance of ${pr.head} stopped: conflict on ${unresolved.join(", ")} needs a decision.`,
      };
    }
  }
  if (await hasMerge(cwd)) {
    await git(["commit", "--quiet", "--no-edit", "-m", `Merge ${MAIN} into ${pr.head}`], cwd);
  }
  await provider.pushBranch({ branch: pr.head });
  if (pr.base !== MAIN) await provider.retarget(pr.number, MAIN);
  return { ok: true };
}

/**
 * Bottom-up merge: for each open task PR whose base PR has merged, merge main into its branch
 * (never rebase, amend or force-push), push, retarget the PR to main, then open the next queued PR.
 */
export async function advanceStack(
  workItemId: string,
  devConfig: DevHarnessConfig | null | undefined,
  options?: AdvanceStackOptions,
): Promise<AdvanceStackResult> {
  const config = resolveStackConfig(devConfig);
  if (!config.enabled) {
    return {
      ok: false,
      text: "Stack tools are disabled: stack.enabled is false. Set stack.enabled to true in accord.json to use them.",
    };
  }
  const cwd = options?.cwd ?? process.cwd();
  const provider = options?.provider ?? resolveStackProvider(config.provider, { cwd });
  let original = "";
  let started = false;
  try {
    const prs = await provider.listPrs({ state: "all" });
    const prefix = `accord/${workItemId}/task-`;
    const merged = new Set(prs.filter((pr) => pr.state === "merged").map((pr) => pr.head));
    const parents = parentHeads(workItemId, cwd, config.sizing);
    const eligible: { pr: StackPr; baseHead: string }[] = [];
    for (const pr of prs) {
      if (pr.state !== "open" || !pr.head.startsWith(prefix)) continue;
      const planned = parents.get(pr.head);
      const baseHead = planned ?? (pr.base !== MAIN ? pr.base : undefined);
      if (baseHead !== undefined && merged.has(baseHead)) eligible.push({ pr, baseHead });
    }
    const lines: string[] = [];
    if (eligible.length > 0) {
      if ((await git(["status", "--porcelain", "--untracked-files=no"], cwd)).trim()) {
        return { ok: false, text: "Working tree has uncommitted changes; commit or stash them." };
      }
      await git(["fetch", "--quiet", "origin"], cwd);
      original = (await git(["symbolic-ref", "--short", "-q", "HEAD"], cwd).catch(() => "")).trim();
      if (!original) original = (await git(["rev-parse", "HEAD"], cwd)).trim();
      started = true;
      for (const { pr, baseHead } of eligible) {
        const step = await advanceOne(workItemId, cwd, pr, baseHead, provider);
        if (!step.ok) return { ok: false, text: step.text };
        lines.push(`- #${String(pr.number)} ${pr.head} <- ${MAIN}`);
      }
      await git(["checkout", "--quiet", original], cwd);
      original = "";
      const submitted = await stackSubmit(workItemId, devConfig, { cwd, provider });
      return {
        ok: submitted.ok,
        text: `Advanced ${lines.length} PR(s):\n${lines.join("\n")}\n${submitted.text}`,
      };
    }
    const submitted = await stackSubmit(workItemId, devConfig, { cwd, provider });
    return { ok: submitted.ok, text: `No PR to advance.\n${submitted.text}` };
  } catch (error) {
    return { ok: false, text: errorText(error) };
  } finally {
    if (started && (await hasMerge(cwd)))
      await git(["merge", "--abort"], cwd).catch(() => undefined);
    if (original) await git(["checkout", "--quiet", original], cwd).catch(() => undefined);
  }
}
