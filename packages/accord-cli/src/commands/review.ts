import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import {
  buildStandaloneReviewTasks,
  isStandaloneReviewTestFile,
  parseStandaloneReviewAgentResult,
  prepareStandaloneReviewContext,
  resolveStandaloneReviewTestCommand,
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
  const prepared = await prepareStandaloneReviewContext(ctx.cwd);
  if (!prepared.ok) {
    cliNotify("warning", prepared.error);
    return 1;
  }

  const review = prepared.value;
  cliNotify(
    "info",
    `Reviewing ${review.source} diff (${String(review.file_list.length)} files) at ${review.diff_path}.`,
  );

  try {
    const testOutput = await maybeRunTests(ctx, review.file_list);
    const tasks = buildStandaloneReviewTasks({
      diff_path: review.diff_path,
      source: review.source,
      file_list: review.file_list,
      local_layers: review.local_layers,
      test_output: testOutput,
    });

    cliNotify("info", `Starting ${tasks.map((task) => task.agent).join(", ")} in parallel…`);

    const agentResults = await Promise.all(
      tasks.map(async (task) => {
        const spawnResult = await harness.spawnSubagent({ agent: task.agent, task: task.task });
        return parseStandaloneReviewAgentResult(task.agent, {
          exitCode: spawnResult.exitCode ?? 1,
          parsedReturn: spawnResult.parsedReturn,
          output: spawnResult.output,
          stderr: spawnResult.stderr,
        });
      }),
    );

    const report = synthesizeStandaloneReviewReport(agentResults);

    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return report.agents.some((agent) => agent.exit_code !== 0) ? 1 : 0;
    }

    console.log(report.formatted);
    return report.agents.some((agent) => agent.exit_code !== 0) ? 1 : 0;
  } finally {
    await review.cleanup();
  }
}

async function maybeRunTests(ctx: CliContext, files: string[]): Promise<string | undefined> {
  const hasTests = files.some(isStandaloneReviewTestFile);
  const testCommand = await resolveStandaloneReviewTestCommand(ctx.cwd, ctx.devConfig);
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
