/**
 * repo_verify — run Dev Harness verification commands in the correct cwd.
 */

import { loadDevHarnessConfig } from "@clive.shirley/accord-core/config/index.js";
import {
  formatVerificationResults,
  runVerificationCommands,
} from "@clive.shirley/accord-core/verification/runner.js";
import { gitRoot } from "../git.js";
import { listGitWorktrees, resolveWorktreeQuery } from "../worktree/resolve.js";

export interface RepoVerifyParams {
  cwd?: string;
  worktree?: string;
  filter?: string;
  commands?: string[];
}

export interface RepoVerifyResult {
  cwd: string;
  commands: string[];
  results: Awaited<ReturnType<typeof runVerificationCommands>>;
  allPass: boolean;
}

export async function runRepoVerify(
  defaultCwd: string,
  params: RepoVerifyParams,
  signal?: AbortSignal,
): Promise<RepoVerifyResult> {
  let targetCwd = params.cwd ?? defaultCwd;

  if (params.worktree) {
    const root = await gitRoot(defaultCwd, signal);
    const worktrees = await listGitWorktrees(root, signal);
    const match = resolveWorktreeQuery(worktrees, params.worktree);
    if (!match) {
      throw new Error(
        `No worktree matching "${params.worktree}". Paths: ${worktrees.map((w) => w.path).join(", ") || "(none)"}`,
      );
    }
    targetCwd = match.path;
  } else {
    targetCwd = await gitRoot(targetCwd, signal);
  }

  let commands = params.commands;
  if (!commands || commands.length === 0) {
    const config = loadDevHarnessConfig(targetCwd);
    if (!config) {
      throw new Error("No Dev Harness config — pass commands explicitly or add ## Dev Harness to AGENTS.md");
    }
    commands = config.verification_commands;
  }

  if (params.filter?.trim()) {
    const needle = params.filter.trim().toLowerCase();
    commands = commands.filter((c) => c.toLowerCase().includes(needle));
    if (commands.length === 0) {
      throw new Error(`No verification commands matched filter "${params.filter}"`);
    }
  }

  const results = await runVerificationCommands(commands, { cwd: targetCwd });
  const allPass = results.every((r) => r.exitCode === 0);

  return { cwd: targetCwd, commands, results, allPass };
}

export function formatRepoVerify(result: RepoVerifyResult): string {
  const header = `Verify cwd: ${result.cwd}\nCommands: ${result.commands.length}\n`;
  const body = formatVerificationResults(result.results, "Verification");
  const verdict = result.allPass ? "\n**All checks passed.**" : "\n**Some checks failed.**";
  return header + body + verdict;
}
