import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import {
  buildStandaloneReviewTasks,
  gatherStandaloneReviewDiff,
  isStandaloneReviewTestFile,
  parseStandaloneReviewAgentResult,
  synthesizeStandaloneReviewReport,
  truncateStandaloneTestOutput,
} from "@clive.shirley/accord-core/review/standalone.js";
import type { CliContext } from "../context.js";
import type { AgentHarness } from "../harnesses/types.js";
import { cliNotify } from "../notify.js";

const execFile = promisify(execFileCb);

export type ReviewCommandOptions = {
  json?: boolean;
};

export async function runReviewCommand(
  ctx: CliContext,
  harness: AgentHarness,
  options: ReviewCommandOptions,
): Promise<number> {
  const diffResult = await gatherStandaloneReviewDiff(ctx.cwd);
  if (!diffResult.ok) {
    cliNotify("warning", diffResult.error);
    return 1;
  }

  const diff = diffResult.value;
  cliNotify("info", `Reviewing ${diff.source} diff (${String(diff.file_list.length)} files).`);

  const testOutput = await maybeRunTests(ctx, diff.file_list);
  const tasks = buildStandaloneReviewTasks({
    diff: diff.diff,
    file_list: diff.file_list,
    test_output: testOutput,
  });

  const agentResults = [];
  for (const task of tasks) {
    cliNotify("info", `Starting ${task.agent}…`);
    const spawnResult = await harness.spawnSubagent({ agent: task.agent, task: task.task });
    agentResults.push(
      parseStandaloneReviewAgentResult(task.agent, {
        exitCode: spawnResult.exitCode ?? 1,
        parsedReturn: spawnResult.parsedReturn,
      }),
    );
  }

  const report = synthesizeStandaloneReviewReport(agentResults);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return report.agents.some((agent) => agent.exit_code !== 0) ? 1 : 0;
  }

  console.log(report.formatted);
  return report.agents.some((agent) => agent.exit_code !== 0) ? 1 : 0;
}

async function maybeRunTests(ctx: CliContext, files: string[]): Promise<string | undefined> {
  const hasTests = files.some(isStandaloneReviewTestFile);
  const testCommand = ctx.devConfig?.test?.command?.trim();
  if (!hasTests || !testCommand) {
    return undefined;
  }

  try {
    const { stdout, stderr } = await execFile(testCommand, {
      cwd: ctx.cwd,
      shell: true,
      maxBuffer: 10 * 1024 * 1024,
    });
    return truncateStandaloneTestOutput(`${stdout}\n${stderr}`.trim());
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string; message?: string };
    const combined = `${execError.stdout ?? ""}\n${execError.stderr ?? ""}`.trim();
    if (combined) {
      return truncateStandaloneTestOutput(combined);
    }
    return `(test command failed: ${execError.message ?? "unknown error"})`;
  }
}
