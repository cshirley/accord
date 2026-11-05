import { readdirSync } from "node:fs";
import { join } from "node:path";
import { type AccordTrailer, parseAccordTrailer } from "../commit/commit-grammar.js";
import { registerPrGroupResolver } from "../commit/hooks.js";
import { resolveStackConfig } from "../config/stack-flags.js";
import type { DevHarnessConfig } from "../config/types.js";
import { git } from "../git/helpers.js";
import { readJson } from "../work-items/io.js";
import "./branches.js";
import { computeStack } from "./compute-stack.js";
import { openablePrs, validateFlags } from "./depth.js";
import { resolveStackProvider, type StackPr, type StackProvider } from "./provider.js";
import {
  type PrBriefAc,
  renderPrBrief,
  renderStackMap,
  renderStackReport,
  renderStackTable,
  type StackReportRow,
} from "./render.js";
import type { PrGroup, StackPlan, StackPlanTask } from "./types.js";

export interface StackServiceOptions {
  cwd?: string;
  /** Injected provider; when absent the provider named by stack.provider is resolved. */
  provider?: StackProvider;
}

export interface StackServiceResult {
  ok: boolean;
  text: string;
}

type StackServiceFn = (
  workItemId: string,
  devConfig: DevHarnessConfig | null | undefined,
  options?: StackServiceOptions,
) => Promise<StackServiceResult>;

type PlanFile = { tasks: StackPlanTask[] };

type SpecFile = {
  acceptance_criteria?: { id: string; scenario?: string; criterion?: string }[];
  verification?: { test_cases?: { covers?: string; test_name_glob?: string }[] };
};

const BASE_BRANCH = "main";

const DISABLED_TEXT =
  "Stack tools are disabled: stack.enabled is false. Set stack.enabled to true in accord.json to use them.";

function readPlan(workItemId: string, cwd: string): PlanFile | null {
  try {
    const plan = readJson<PlanFile>(join(cwd, "docs", "dev", workItemId, "plan.json"));
    return plan && Array.isArray(plan.tasks) ? plan : null;
  } catch {
    return null;
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function headFor(workItemId: string, pr: PrGroup): string {
  return `accord/${workItemId}/task-${pr.tasks[0]}`;
}

function taskPrs(plan: StackPlan): PrGroup[] {
  return plan.prs.filter((pr) => pr.kind === "task");
}

function acsOf(pr: PrGroup, tasks: StackPlanTask[]): string[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return [...new Set(pr.tasks.flatMap((id) => byId.get(id)?.covers_ac ?? []))];
}

type Prepared = { ok: true; cwd: string; plan: PlanFile; stack: StackPlan } | StackServiceResult;

function prepare(
  workItemId: string,
  devConfig: DevHarnessConfig | null | undefined,
  options: StackServiceOptions | undefined,
): Prepared {
  const config = resolveStackConfig(devConfig);
  if (!config.enabled) return { ok: false, text: DISABLED_TEXT };
  const cwd = options?.cwd ?? process.cwd();
  const plan = readPlan(workItemId, cwd);
  if (!plan) {
    return { ok: false, text: `No readable plan at docs/dev/${workItemId}/plan.json` };
  }
  try {
    return { ok: true, cwd, plan, stack: computeStack(plan, config.sizing) };
  } catch (error) {
    return { ok: false, text: errorText(error) };
  }
}

function isPrepared(value: Prepared): value is Extract<Prepared, { stack: StackPlan }> {
  return "stack" in value;
}

function providerFor(
  devConfig: DevHarnessConfig | null | undefined,
  options: StackServiceOptions | undefined,
  cwd: string,
): StackProvider {
  return options?.provider ?? resolveStackProvider(resolveStackConfig(devConfig).provider, { cwd });
}

export const stackShow: StackServiceFn = async (workItemId, devConfig, options) => {
  const prepared = prepare(workItemId, devConfig, options);
  if (!isPrepared(prepared)) return prepared;
  const { plan, stack } = prepared;
  const flags = stack.flags.map(
    (flag) => `- task ${flag.task} flagged: ${flag.reasons.join(", ")}`,
  );
  const table = renderStackTable(workItemId, stack, plan.tasks);
  return { ok: true, text: flags.length > 0 ? `${table}\n${flags.join("\n")}\n` : table };
};

export const stackSync: StackServiceFn = async (workItemId, devConfig, options) => {
  const prepared = prepare(workItemId, devConfig, options);
  if (!isPrepared(prepared)) return prepared;
  const { cwd, plan, stack } = prepared;
  try {
    const provider = providerFor(devConfig, options, cwd);
    const known = new Map<string, StackPr>(
      (await provider.listPrs({ state: "all" })).map((pr) => [pr.head, pr]),
    );
    const lines = taskPrs(stack).map((pr) => {
      const head = headFor(workItemId, pr);
      const found = known.get(head);
      const acs = renderStackTable(workItemId, { ...stack, prs: [pr] }, plan.tasks)
        .split("\n")[2]
        ?.split("|")[4]
        ?.trim();
      const status = found ? `#${found.number} ${found.state}` : "not submitted";
      return `- PR ${pr.index} ${status} ${head} ${acs ?? "-"}`;
    });
    const table = renderStackTable(workItemId, stack, plan.tasks);
    return { ok: true, text: `${table}\n${lines.join("\n")}\n` };
  } catch (error) {
    return { ok: false, text: errorText(error) };
  }
};

function originWebUrl(remote: string): string {
  const match =
    /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/git@|git@)([^/:]+)[/:](.+?)(?:\.git)?\/?$/.exec(
      remote.trim(),
    );
  if (!match) throw new Error(`Cannot derive a web URL from origin remote ${remote.trim()}`);
  return `https://${match[1]}/${match[2]}`;
}

async function contractLink(workItemId: string, cwd: string): Promise<string> {
  const web = originWebUrl(await git(["remote", "get-url", "origin"], cwd));
  const sha = (
    await git(["rev-parse", `accord/${workItemId}/contract^{commit}`], cwd).catch(() => {
      throw new Error(`Contract tag accord/${workItemId}/contract not found`);
    })
  ).trim();
  return `${web}/blob/${sha}/docs/dev/${workItemId}/contract.lock.json`;
}

function briefAcs(spec: SpecFile | null, acIds: string[]): PrBriefAc[] {
  return acIds.map((id) => {
    const criterion = spec?.acceptance_criteria?.find((ac) => ac.id === id);
    const text = criterion?.scenario ?? criterion?.criterion;
    const tests = (spec?.verification?.test_cases ?? [])
      .filter((testCase) => testCase.covers === id && testCase.test_name_glob)
      .map((testCase) => testCase.test_name_glob as string);
    return { id, ...(text ? { text } : {}), tests };
  });
}

export const stackSubmit: StackServiceFn = async (workItemId, devConfig, options) => {
  const prepared = prepare(workItemId, devConfig, options);
  if (!isPrepared(prepared)) return prepared;
  const { cwd, plan, stack } = prepared;
  const config = resolveStackConfig(devConfig);
  const validation = validateFlags(plan, devConfig?.stack?.require_flag !== false);
  if (!validation.ok) {
    const lines = validation.violations.map((v) => `- task ${v.task}: ${v.rule}`);
    return { ok: false, text: `Flag validation failed:\n${lines.join("\n")}\n` };
  }
  try {
    const provider = providerFor(devConfig, options, cwd);
    const known = await provider.listPrs({ state: "all" });
    const mergedHeads = new Set(known.filter((pr) => pr.state === "merged").map((pr) => pr.head));
    const mergedPrs = taskPrs(stack)
      .filter((pr) => mergedHeads.has(headFor(workItemId, pr)))
      .map((pr) => pr.index);
    const openable = new Set(openablePrs(stack, mergedPrs, config.sizing.max_depth));
    const link = await contractLink(workItemId, cwd);
    const spec = readJson<SpecFile>(join(cwd, "docs", "dev", workItemId, "spec.json"));
    const prs = taskPrs(stack).filter((pr) => openable.has(pr.index));
    const heads = new Map(prs.map((pr) => [pr.index, headFor(workItemId, pr)]));
    const byId = new Map(plan.tasks.map((task) => [task.id, task]));
    const created: { pr: PrGroup; head: string; base: string; number: number; url: string }[] = [];
    for (const pr of prs) {
      const head = heads.get(pr.index) as string;
      const parent = Math.max(...(pr.depends_on_prs ?? []).filter((index) => heads.has(index)));
      const base = Number.isFinite(parent) ? (heads.get(parent) as string) : BASE_BRANCH;
      const members = pr.tasks.map((id) => byId.get(id)).filter((t): t is StackPlanTask => !!t);
      const brief = renderPrBrief({
        workItemId,
        contractLink: link,
        acs: briefAcs(spec, acsOf(pr, plan.tasks)),
        summary: `PR ${pr.index} of ${prs.length}: tasks ${pr.tasks.join(", ")}. Evidence status is pending until the evidence commit lands.`,
        risks: [],
        readingOrder: [...new Set(members.flatMap((task) => task.files.map((file) => file.path)))],
      });
      await provider.ensureBranch({ branch: head, base });
      await provider.pushBranch({ branch: head });
      const title = members.map((task) => task.title ?? `Task ${task.id}`).join(" + ");
      const result = await provider.createOrUpdatePr({
        head,
        base,
        title: `${workItemId}: ${title}`,
        body: brief,
      });
      created.push({ pr, head, base, ...result });
    }
    const map = renderStackMap(
      workItemId,
      created.map((entry) => ({
        pr: entry.pr,
        url: entry.url,
        acs: acsOf(entry.pr, plan.tasks),
      })),
    );
    for (const entry of created) {
      await provider.upsertStackMapComment({
        pr: entry.number,
        workItemId,
        body: map,
      });
      const sha = (await git(["rev-parse", `refs/heads/${entry.head}`], cwd)).trim();
      await provider.setEvidenceStatus({
        sha,
        state: "pending",
        description: "No evidence commit yet",
      });
    }
    const lines = created.map(
      (entry) =>
        `- PR ${entry.pr.index} #${entry.number} ${entry.url} ${entry.head} <- ${entry.base}`,
    );
    return { ok: true, text: `Submitted ${created.length} PR(s):\n${lines.join("\n")}\n` };
  } catch (error) {
    return { ok: false, text: errorText(error) };
  }
};

export const stackReport: StackServiceFn = async (workItemId, devConfig, options) => {
  const prepared = prepare(workItemId, devConfig, options);
  if (!isPrepared(prepared)) return prepared;
  const { cwd, stack } = prepared;
  const prByTask = new Map<number, number>();
  for (const pr of taskPrs(stack)) for (const task of pr.tasks) prByTask.set(task, pr.index);
  const log = await git(["log", "--reverse", "--format=%B%x1e"], cwd).catch(() => "");
  const rows = new Map<string, StackReportRow>();
  for (const message of log.split("\x1e")) {
    let trailer: AccordTrailer | null;
    try {
      trailer = parseAccordTrailer(message);
    } catch {
      continue;
    }
    const pr = trailer ? prByTask.get(trailer.task) : undefined;
    if (!trailer || trailer.id !== workItemId || pr === undefined) continue;
    const key = `${pr}:${trailer.task}`;
    const row = rows.get(key) ?? { pr, task: trailer.task, trailers: [] };
    row.trailers.push(trailer);
    rows.set(key, row);
  }
  return { ok: true, text: renderStackReport(workItemId, [...rows.values()]) };
};

function groupFor(entry: string, taskId: number, cwd: string): number[] | undefined {
  const plan = readPlan(entry, cwd);
  if (!plan?.tasks.some((task) => task.id === taskId)) return undefined;
  const group = computeStack(plan, resolveStackConfig(null).sizing).prs.find((pr) =>
    pr.tasks.includes(taskId),
  );
  return group ? [...group.tasks] : [taskId];
}

/** Maps a task to the tasks of its PR from the committed plan (default PR group resolver). */
export function resolveGroup(taskId: number, workItemId?: string): number[] {
  try {
    const cwd = process.cwd();
    // Task ids repeat across work items: with a work item id only that plan is consulted.
    if (workItemId) return groupFor(workItemId, taskId, cwd) ?? [taskId];
    for (const entry of readdirSync(join(cwd, "docs", "dev"))) {
      const group = groupFor(entry, taskId, cwd);
      if (group) return group;
    }
  } catch {
    // fall through to the task itself
  }
  return [taskId];
}

registerPrGroupResolver(resolveGroup);
