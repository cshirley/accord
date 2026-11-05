import type {
  PrGroup,
  StackFlag,
  StackFlagReason,
  StackPlan,
  StackPlanTask,
  StackSizing,
} from "./types.js";

type Group = { tasks: StackPlanTask[]; paths: Set<string>; lines: number };

const NEVER_MERGED_KINDS = new Set(["refactor", "schema", "enable"]);

function flagReasons(task: StackPlanTask, sizing: StackSizing): StackFlagReason[] {
  const reasons: StackFlagReason[] = [];
  if ((task.est_lines ?? 0) > sizing.max_pr_lines) reasons.push("max_pr_lines");
  if (task.files.length > sizing.max_files) reasons.push("max_files");
  return reasons;
}

function orderTasks(tasks: StackPlanTask[]): StackPlanTask[] {
  const remaining = [...tasks].sort((left, right) => left.id - right.id);
  const known = new Set(remaining.map((task) => task.id));
  const done = new Set<number>();
  const ordered: StackPlanTask[] = [];
  while (remaining.length > 0) {
    const readyIndex = remaining.findIndex((task) =>
      (task.depends_on ?? []).every((dep) => done.has(dep) || !known.has(dep)),
    );
    if (readyIndex === -1) {
      const ids = remaining.map((task) => task.id).join(", ");
      throw new Error(`computeStack: depends_on cycle or self-dependency among tasks ${ids}`);
    }
    const [next] = remaining.splice(readyIndex, 1);
    if (!next) break;
    done.add(next.id);
    ordered.push(next);
  }
  return ordered;
}

function mergeable(task: StackPlanTask, flagged: Set<number>): boolean {
  return !(
    task.flag ||
    flagged.has(task.id) ||
    (task.kind !== undefined && NEVER_MERGED_KINDS.has(task.kind))
  );
}

export function computeStack(plan: { tasks: StackPlanTask[] }, sizing: StackSizing): StackPlan {
  const flags: StackFlag[] = [];
  const flagged = new Set<number>();
  const ordered = orderTasks(plan.tasks);
  for (const task of ordered) {
    const reasons = flagReasons(task, sizing);
    if (reasons.length > 0) {
      flags.push({ task: task.id, reasons });
      flagged.add(task.id);
    }
  }
  flags.sort((left, right) => left.task - right.task);

  const mergeEnabled = sizing.merge_small_same_concern !== false;
  const groups: Group[] = [];
  for (const task of ordered) {
    const lines = task.est_lines ?? 0;
    const current = groups[groups.length - 1];
    const last = current?.tasks[current.tasks.length - 1];
    if (
      mergeEnabled &&
      current &&
      last?.concern &&
      last.concern === task.concern &&
      current.tasks.every((member) => mergeable(member, flagged)) &&
      mergeable(task, flagged) &&
      (current.lines < sizing.min_pr_lines || lines < sizing.min_pr_lines) &&
      current.lines + lines <= sizing.max_pr_lines &&
      new Set([...current.paths, ...task.files.map((file) => file.path)]).size <= sizing.max_files
    ) {
      current.tasks.push(task);
      for (const file of task.files) current.paths.add(file.path);
      current.lines += lines;
      continue;
    }
    groups.push({
      tasks: [task],
      paths: new Set(task.files.map((file) => file.path)),
      lines,
    });
  }

  const groupIndexByTask = new Map<number, number>();
  groups.forEach((group, position) => {
    for (const member of group.tasks) groupIndexByTask.set(member.id, position + 1);
  });

  const prs: PrGroup[] = [{ index: 0, kind: "contract", tasks: [] }];
  groups.forEach((group, position) => {
    const index = position + 1;
    const deps = new Set<number>();
    for (const member of group.tasks) {
      for (const dep of member.depends_on ?? []) {
        const depIndex = groupIndexByTask.get(dep);
        if (depIndex !== undefined && depIndex !== index) deps.add(depIndex);
      }
    }
    prs.push({
      index,
      kind: "task",
      tasks: group.tasks.map((member) => member.id),
      est_lines: group.lines,
      files: group.paths.size,
      concern: group.tasks[0]?.concern ?? null,
      depends_on_prs: [...deps].sort((left, right) => left - right),
    });
  });
  prs.push({ index: groups.length + 1, kind: "closeout", tasks: [] });

  return { prs, flags, pr_count: prs.length };
}
