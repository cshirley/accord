import type { StackPlan, StackPlanTask } from "./types.js";

export type FlagViolationRule = "missing_flag" | "premature_enable" | "missing_enable";

export interface FlagViolation {
  task: number;
  rule: FlagViolationRule;
}

export interface FlagValidation {
  ok: boolean;
  violations: FlagViolation[];
}

export function openablePrs(
  stack: StackPlan,
  mergedPrs: readonly number[],
  maxDepth: number,
): number[] {
  const merged = new Set(mergedPrs);
  const taskPrs = new Map(
    stack.prs.filter((pr) => pr.kind === "task").map((pr) => [pr.index, pr] as const),
  );
  const unmergedAncestors = (index: number, seen: Set<number>): void => {
    for (const parent of taskPrs.get(index)?.depends_on_prs ?? []) {
      if (!taskPrs.has(parent) || seen.has(parent)) continue;
      seen.add(parent);
      unmergedAncestors(parent, seen);
    }
  };
  return [...taskPrs.keys()]
    .filter((index) => {
      if (merged.has(index)) return false;
      const ancestors = new Set<number>();
      unmergedAncestors(index, ancestors);
      const pending = [...ancestors].filter((ancestor) => !merged.has(ancestor));
      return pending.length + 1 <= maxDepth;
    })
    .sort((left, right) => left - right);
}

function finalTaskId(tasks: StackPlanTask[]): number | null {
  if (tasks.length === 0) return null;
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const depthOf = (id: number, trail: Set<number>): number => {
    if (trail.has(id)) return 0;
    trail.add(id);
    const parents = (byId.get(id)?.depends_on ?? []).filter((parent) => byId.has(parent));
    const depth = parents.length === 0 ? 0 : 1 + Math.max(...parents.map((p) => depthOf(p, trail)));
    trail.delete(id);
    return depth;
  };
  const ranked = tasks.map((task) => ({ id: task.id, depth: depthOf(task.id, new Set()) }));
  ranked.sort((left, right) => right.depth - left.depth || right.id - left.id);
  return ranked[0]?.id ?? null;
}

export function validateFlags(
  plan: { tasks: StackPlanTask[] },
  requireFlag: boolean,
): FlagValidation {
  if (!requireFlag) return { ok: true, violations: [] };
  const finalId = finalTaskId(plan.tasks);
  const violations: FlagViolation[] = [];
  for (const task of [...plan.tasks].sort((left, right) => left.id - right.id)) {
    if (task.id === finalId) {
      if (task.kind !== "enable") violations.push({ task: task.id, rule: "missing_enable" });
      continue;
    }
    if (!task.flag || task.flag.trim() === "") {
      violations.push({ task: task.id, rule: "missing_flag" });
    }
    if (task.kind === "enable") violations.push({ task: task.id, rule: "premature_enable" });
  }
  return { ok: violations.length === 0, violations };
}
