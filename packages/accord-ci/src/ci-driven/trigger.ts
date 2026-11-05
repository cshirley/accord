import { execFileSync } from "node:child_process";
import { loadDevHarnessConfig } from "../../../accord-core/src/config/agents-md.js";

export type Pr0SkipReason = "stack_disabled" | "not_ci_driven_branch" | "unexpected_files";

export interface Pr0TriggerOpts {
  readonly repoRoot: string;
  readonly branch: string;
  readonly baseRef: string;
}

export type Pr0Trigger =
  | { readonly trigger: true; readonly workItemId: string }
  | { readonly trigger: false; readonly reason: Pr0SkipReason };

const BRANCH_PATTERN = /^accord\/([A-Z]+(?:[_-][A-Z]+)*[_-]\d+)\/.+$/;

function git(repoRoot: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function gitOk(repoRoot: string, args: string[]): boolean {
  try {
    execFileSync("git", args, { cwd: repoRoot, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function resolveBase(repoRoot: string, baseRef: string): string {
  const remote = `origin/${baseRef}`;
  return gitOk(repoRoot, ["rev-parse", "--verify", "-q", remote]) ? remote : baseRef;
}

/** Decide whether this push starts CI-driven mode: enabled, accord/<ID>/** branch, only brief.md + spec.json added. */
export function detectPr0Trigger(opts: Pr0TriggerOpts): Pr0Trigger {
  const match = BRANCH_PATTERN.exec(opts.branch);
  if (!match?.[1]) return { trigger: false, reason: "not_ci_driven_branch" };
  const workItemId = match[1];
  if (loadDevHarnessConfig(opts.repoRoot)?.stack?.enabled !== true) {
    return { trigger: false, reason: "stack_disabled" };
  }
  const base = resolveBase(opts.repoRoot, opts.baseRef);
  const lines = git(opts.repoRoot, ["diff", "--name-status", `${base}...HEAD`])
    .split("\n")
    .filter(Boolean);
  const expected = [`docs/dev/${workItemId}/brief.md`, `docs/dev/${workItemId}/spec.json`].sort();
  const added = lines.filter((line) => line.startsWith("A\t")).map((line) => line.slice(2));
  if (lines.length !== expected.length || added.slice().sort().join("\n") !== expected.join("\n")) {
    return { trigger: false, reason: "unexpected_files" };
  }
  return { trigger: true, workItemId };
}
