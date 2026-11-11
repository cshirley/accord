export type StackTaskKind = "feature" | "refactor" | "schema" | "interface" | "enable";

export type StackPlanTask = {
  id: number;
  title?: string;
  covers_ac?: string[];
  depends_on?: number[];
  est_lines?: number;
  concern?: string;
  flag?: string;
  kind?: StackTaskKind;
  files: { path: string; action: string }[];
};

export type StackSizing = {
  max_pr_lines: number;
  min_pr_lines: number;
  max_files: number;
  /** Carried for config parity; open-PR depth is enforced by trunk-hardening (AC-16), not computeStack. */
  max_depth: number;
  merge_small_same_concern?: boolean;
};

export type StackFlagReason = "max_pr_lines" | "max_files";

export type StackFlag = { task: number; reasons: StackFlagReason[] };

export type PrGroup = {
  index: number;
  kind: "contract" | "task" | "closeout";
  tasks: number[];
  est_lines?: number;
  files?: number;
  concern?: string | null;
  depends_on_prs?: number[];
};

export type StackPlan = {
  prs: PrGroup[];
  flags: StackFlag[];
  pr_count: number;
};
