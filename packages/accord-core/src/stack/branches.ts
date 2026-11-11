import { join } from "node:path";
import { registerCloseoutBranchHook } from "../commit/hooks.js";
import { resolveStackConfig } from "../config/stack-flags.js";
import type { DevHarnessConfig } from "../config/types.js";
import { git } from "../git/helpers.js";
import { readJson } from "../work-items/io.js";
import { computeStack } from "./compute-stack.js";
import { resolveStackProvider, type StackProvider } from "./provider.js";
import type { PrGroup, StackPlanTask } from "./types.js";

export interface StackBranchOptions {
  cwd?: string;
  provider?: StackProvider;
}

export type StackBranchFailure = "disabled" | "invalid_id" | "no_plan" | "dirty" | "other";

export type StackBranchResult =
  | { ok: true; branch: string; base: string }
  | { ok: false; reason: string; code?: StackBranchFailure };

const SAFE_WORK_ITEM_ID = /^[A-Z]+(?:[_-][A-Z]+)*[_-]\d+$/;
const MAIN_REF = "origin/main";

/** Namespace distinct from the CI-driven `accord/<ID>/*` trigger branches. */
export function branchFor(workItemId: string, pr: number | "closeout"): string {
  return pr === "closeout" ? `stack/${workItemId}/closeout` : `stack/${workItemId}/pr-${pr}`;
}

function refuse(reason: string, code: StackBranchFailure = "other"): StackBranchResult {
  return { ok: false, reason, code };
}

function message(error: unknown): string {
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

async function fetchOrigin(cwd: string): Promise<void> {
  await git(["fetch", "--quiet", "origin"], cwd);
}

async function isDirty(cwd: string): Promise<boolean> {
  const status = await git(["status", "--porcelain", "--untracked-files=no"], cwd);
  return status.trim().length > 0;
}

function dirtyRefusal(branch: string): StackBranchResult {
  return refuse(
    `Working tree has uncommitted changes; commit or stash them before switching to ${branch}.`,
    "dirty",
  );
}

async function switchTo(branch: string, base: string, cwd: string): Promise<StackBranchResult> {
  try {
    if (await succeeds(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`], cwd)) {
      await git(["checkout", "--quiet", branch], cwd);
    } else {
      await git(["checkout", "--quiet", "-b", branch, base], cwd);
    }
    return { ok: true, branch, base };
  } catch (error) {
    return refuse(`Could not switch to ${branch}: ${message(error)}`);
  }
}

function readPlanTasks(workItemId: string, cwd: string): StackPlanTask[] | null {
  try {
    const plan = readJson<{ tasks?: StackPlanTask[] }>(
      join(cwd, "docs", "dev", workItemId, "plan.json"),
    );
    return plan && Array.isArray(plan.tasks) ? plan.tasks : null;
  } catch {
    return null;
  }
}

async function contractBase(workItemId: string, cwd: string): Promise<string | StackBranchResult> {
  const lock = `docs/dev/${workItemId}/contract.lock.json`;
  const merged = await succeeds(["cat-file", "-e", `${MAIN_REF}:${lock}`], cwd);
  if (merged) return MAIN_REF;
  const tag = `accord/${workItemId}/contract`;
  if (await succeeds(["rev-parse", "--verify", "--quiet", `${tag}^{commit}`], cwd)) {
    return `${tag}^{commit}`;
  }
  return refuse(`Contract PR0 is unmerged and its tag ${tag} was not found; cannot pick a base.`);
}

export async function ensureTaskBranch(
  workItemId: string,
  taskId: number,
  devConfig: DevHarnessConfig | null | undefined,
  options?: StackBranchOptions,
): Promise<StackBranchResult> {
  const config = resolveStackConfig(devConfig);
  if (!config.enabled) return refuse("stack.enabled is false.", "disabled");
  if (!SAFE_WORK_ITEM_ID.test(workItemId)) {
    return refuse(`Unsafe work item id ${JSON.stringify(workItemId)}.`, "invalid_id");
  }
  const cwd = options?.cwd ?? process.cwd();
  const tasks = readPlanTasks(workItemId, cwd);
  if (!tasks) return refuse(`No readable plan at docs/dev/${workItemId}/plan.json`, "no_plan");
  let prs: PrGroup[];
  try {
    prs = computeStack({ tasks }, config.sizing).prs.filter((pr) => pr.kind === "task");
  } catch (error) {
    return refuse(message(error));
  }
  const group = prs.find((pr) => pr.tasks.includes(taskId));
  if (!group) return refuse(`Task ${taskId} is not in the plan of ${workItemId}.`, "no_plan");
  const branch = branchFor(workItemId, group.index);
  if (group.tasks[0] !== taskId) {
    return { ok: true, branch, base: branch };
  }
  try {
    if ((await git(["rev-parse", "--abbrev-ref", "HEAD"], cwd)).trim() === branch) {
      return { ok: true, branch, base: branch };
    }
    if (await isDirty(cwd)) return dirtyRefusal(branch);
    await fetchOrigin(cwd).catch(() => undefined);
    const parent = Math.max(...(group.depends_on_prs ?? []).filter((index) => index > 0), 0);
    let base: string;
    if (parent > 0) {
      base = branchFor(workItemId, parent);
      if (!(await succeeds(["rev-parse", "--verify", "--quiet", `refs/heads/${base}`], cwd))) {
        return refuse(`Parent branch ${base} does not exist yet; finish its PR first.`);
      }
    } else {
      const picked = await contractBase(workItemId, cwd);
      if (typeof picked !== "string") return picked;
      base = picked;
    }
    return await switchTo(branch, base, cwd);
  } catch (error) {
    return refuse(message(error));
  }
}

export async function ensureCloseoutBranch(
  workItemId: string,
  devConfig: DevHarnessConfig | null | undefined,
  options?: StackBranchOptions,
): Promise<StackBranchResult> {
  const config = resolveStackConfig(devConfig);
  if (!config.enabled) return refuse("stack.enabled is false.", "disabled");
  if (!SAFE_WORK_ITEM_ID.test(workItemId)) {
    return refuse(`Unsafe work item id ${JSON.stringify(workItemId)}.`, "invalid_id");
  }
  const cwd = options?.cwd ?? process.cwd();
  const branch = branchFor(workItemId, "closeout");
  try {
    if (await isDirty(cwd)) return dirtyRefusal(branch);
    const provider = options?.provider ?? resolveStackProvider(config.provider, { cwd });
    const prefix = `stack/${workItemId}/pr-`;
    const unmerged = (await provider.listPrs({ state: "all" })).filter(
      (pr) => pr.head.startsWith(prefix) && pr.state !== "merged",
    );
    if (unmerged.length > 0) {
      return refuse(
        `Closeout blocked: unmerged task PRs: ${unmerged.map((pr) => `${pr.head} (#${pr.number}, ${pr.state})`).join(", ")}. Merge them first.`,
      );
    }
    await fetchOrigin(cwd);
    return await switchTo(branch, MAIN_REF, cwd);
  } catch (error) {
    return refuse(message(error));
  }
}

registerCloseoutBranchHook(
  ensureCloseoutBranch as Parameters<typeof registerCloseoutBranchHook>[0],
);
