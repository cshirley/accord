import { execFileSync, spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadDevHarnessConfig } from "@clive.shirley/accord-core/config/agents-md.js";
import { resolveStackConfig } from "@clive.shirley/accord-core/config/stack-flags.js";
import { computeStack } from "@clive.shirley/accord-core/stack/compute-stack.js";
import { renderStackTable } from "@clive.shirley/accord-core/stack/render.js";
import type { StackPlanTask } from "@clive.shirley/accord-core/stack/types.js";
import {
  loadWorkItem,
  workItemJsonPath,
  writeJson,
} from "@clive.shirley/accord-core/work-items/io.js";
import { devBootstrap } from "@clive.shirley/accord-core/work-items/lifecycle.js";
import type { ExecResult } from "../commit-and-pr.js";
import { MissingSecretError } from "../lib/env.js";
import { type PhaseRunBackend, runPhase } from "../run-phase.js";
import { CI_PUSH_TOKEN_NAME } from "./startup.js";
import { detectPr0Trigger, type Pr0SkipReason } from "./trigger.js";

export type { Pr0SkipReason, Pr0Trigger } from "./trigger.js";
export { detectPr0Trigger } from "./trigger.js";

export type Pr0ExecLike = (
  cmd: string,
  args: readonly string[],
  opts?: { cwd?: string; env?: Readonly<Record<string, string | undefined>> },
) => Promise<ExecResult>;

export type Pr0Result =
  | { readonly status: "skipped"; readonly reason: Pr0SkipReason }
  | { readonly status: "gate"; readonly workItemId: string; readonly sha: string };

export interface RunPr0Opts {
  readonly repoRoot: string;
  readonly branch: string;
  readonly baseRef: string;
  readonly dryRun: boolean;
  readonly runBackend?: PhaseRunBackend;
  readonly exec?: Pr0ExecLike;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

const defaultExec: Pr0ExecLike = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, [...args], {
      cwd: opts?.cwd,
      env: { ...process.env, ...opts?.env } as NodeJS.ProcessEnv,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
  });

function git(repoRoot: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function bootstrapLocalWorkItem(repoRoot: string, workItemId: string): void {
  const previous = process.cwd();
  process.chdir(repoRoot);
  try {
    devBootstrap(workItemId, workItemId, "implement", "standard", {
      intent_mode: "pipeline",
      intent_confidence: "high",
      escalation_ceiling: "pipeline_allowed",
    });
    const wi = loadWorkItem(workItemId);
    if (!wi) throw new Error(`PR0 bootstrap failed: work item ${workItemId} not created`);
    writeJson(workItemJsonPath(workItemId), {
      ...wi,
      phase: "planning",
      brief: `docs/dev/${workItemId}/brief.md`,
      spec: `docs/dev/${workItemId}/spec.json`,
    });
  } finally {
    process.chdir(previous);
  }
}

export async function runPr0(opts: RunPr0Opts): Promise<Pr0Result> {
  const env = opts.env ?? process.env;
  const detected = detectPr0Trigger(opts);
  if (!detected.trigger) return { status: "skipped", reason: detected.reason };
  const { workItemId } = detected;

  const token = env[CI_PUSH_TOKEN_NAME];
  if (!opts.dryRun && (token === undefined || token === "")) {
    throw new MissingSecretError(CI_PUSH_TOKEN_NAME);
  }

  bootstrapLocalWorkItem(opts.repoRoot, workItemId);
  const phase = await runPhase({
    phase: "plan",
    ticket: workItemId,
    cwd: opts.repoRoot,
    runBackend: opts.runBackend,
  });
  if (phase.status !== "done") {
    throw new Error(`phase-plan did not complete for ${workItemId}: ${phase.status}`);
  }

  const dir = join(opts.repoRoot, "docs", "dev", workItemId);
  const planPath = join(dir, "plan.json");
  if (!existsSync(planPath)) throw new Error(`phase-plan wrote no plan.json for ${workItemId}`);
  let tasks: StackPlanTask[];
  try {
    const plan = JSON.parse(readFileSync(planPath, "utf8")) as { tasks?: StackPlanTask[] };
    if (!Array.isArray(plan.tasks)) throw new Error("tasks missing");
    tasks = plan.tasks;
  } catch (error) {
    throw new Error(
      `phase-plan wrote an invalid plan.json for ${workItemId}: ${(error as Error).message}`,
    );
  }

  const config = loadDevHarnessConfig(opts.repoRoot);
  const stack = computeStack({ tasks }, resolveStackConfig(config).sizing);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "stack.md"),
    `# Proposed stack for ${workItemId}\n\n${renderStackTable(workItemId, stack, tasks)}`,
  );

  git(opts.repoRoot, [
    "add",
    `docs/dev/${workItemId}/plan.json`,
    `docs/dev/${workItemId}/stack.md`,
  ]);
  git(opts.repoRoot, [
    "commit",
    "-q",
    "-m",
    `chore(${workItemId}): PR0 plan and proposed stack`,
    "-m",
    `Accord: id=${workItemId} outcome=pr0`,
  ]);
  const sha = git(opts.repoRoot, ["rev-parse", "HEAD"]);

  if (!opts.dryRun && token) {
    const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
    const exec = opts.exec ?? defaultExec;
    const result = await exec(
      "git",
      [
        "-c",
        `http.extraheader=AUTHORIZATION: basic ${basic}`,
        "push",
        "origin",
        `HEAD:refs/heads/${opts.branch}`,
      ],
      { cwd: opts.repoRoot },
    );
    if (result.exitCode !== 0) {
      throw new Error(`git push of ${opts.branch} failed (exit ${result.exitCode})`);
    }
  }
  return { status: "gate", workItemId, sha };
}

function writeOutput(line: string): void {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${line}\n`);
}

async function main(): Promise<number> {
  const result = await runPr0({
    repoRoot: process.env.GITHUB_WORKSPACE || process.cwd(),
    branch: process.env.GITHUB_REF_NAME ?? "",
    baseRef: process.env.ACCORD_CI_BASE_REF || "main",
    dryRun: process.env.ACCORD_CI_DRY_RUN === "true",
  });
  writeOutput(`status=${result.status}`);
  console.log(`accord-driven: PR0 ${result.status}`);
  return 0;
}

if (import.meta.main) {
  try {
    process.exit(await main());
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
