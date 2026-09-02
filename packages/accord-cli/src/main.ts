#!/usr/bin/env bun
/**
 * Standalone ACCORD orchestrator CLI entry.
 */

import path from "node:path";
import { parseCli, printHelp } from "./cli.js";
import {
  runFinishCommand,
  runInitCommand,
  runPlanCommand,
  runResumeCommand,
  runReviewCommand,
  runTasksCommand,
  runWorkflowCommand,
} from "./commands/index.js";
import { createCliContext } from "./context.js";
import { createHarness, parseHarnessId } from "./harnesses/registry.js";
import type { AgentHarnessId } from "./harnesses/types.js";
import { cliNotify } from "./notify.js";

async function main(): Promise<number> {
  const parsed = parseCli(process.argv.slice(2));

  if (parsed.kind === "help") {
    printHelp();
    return 0;
  }
  if (parsed.kind === "error") {
    console.error(parsed.message);
    printHelp();
    return 1;
  }

  const cwd = path.resolve(parsed.kind === "init" ? parsed.options.cwd : parsed.options.cwd);
  process.chdir(cwd);

  if (parsed.kind === "tasks") {
    return runTasksCommand({ json: parsed.options.json });
  }

  const ctx = createCliContext(cwd);

  if (parsed.kind === "init") {
    return runInitCommand(ctx, {
      json: parsed.options.json,
      write: parsed.options.write,
      target: parsed.options.target,
    });
  }

  if (parsed.kind === "plan") {
    return runPlanCommand(ctx, parsed.command, parsed.workItemId, { json: parsed.options.json });
  }

  let harnessId: AgentHarnessId;
  try {
    harnessId = parseHarnessId(parsed.options.harness);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return 1;
  }

  const harness = createHarness(harnessId, ctx, {
    autoConfirm: parsed.options.yes,
    spawnNotifyLabel: parsed.kind,
  });

  if (parsed.kind === "workflow") {
    const result = await runWorkflowCommand(
      ctx,
      harness,
      parsed.subcommand,
      parsed.workItemId,
      parsed.rawArgs,
    );
    return result.exitCode;
  }

  if (parsed.kind === "resume") {
    const result = await runResumeCommand(ctx, harness, parsed.workItemId);
    return result.exitCode;
  }

  if (parsed.kind === "finish") {
    const result = await runFinishCommand(ctx, harness, parsed.workItemId);
    return result.exitCode;
  }

  if (parsed.kind === "review") {
    return runReviewCommand(ctx, harness, { json: parsed.options.json });
  }

  cliNotify("error", "Unhandled command");
  return 1;
}

const code = await main();
process.exit(code);
