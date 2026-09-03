/**
 * Shared command dispatch — used by main entry and interactive shell.
 */

import path from "node:path";
import type { ParsedCli } from "./cli.js";
import {
  runCompletionCommand,
  runConfigInitCommand,
  runDeviationsCommand,
  runDevHelpCommand,
  runDriveCommand,
  runFinishCommand,
  runGapsCommand,
  runInitCommand,
  runPlanCommand,
  runRehydrateCommand,
  runResumeCommand,
  runRetroCommand,
  runReviewCommand,
  runRunCommand,
  runSpecGapsCommand,
  runTagCommand,
  runTasksCommand,
  runWorkflowCommand,
} from "./commands/index.js";
import { createCliContext } from "./context.js";
import { createHarness, parseHarnessSelectionFromCli } from "./harnesses/registry.js";
import { cliNotify } from "./notify.js";

export async function executeParsed(parsed: ParsedCli): Promise<number> {
  if (parsed.kind === "help") {
    const { printHelp } = await import("./cli.js");
    printHelp();
    return 0;
  }

  if (parsed.kind === "dev-help") {
    return runDevHelpCommand({ json: parsed.options.json });
  }

  if (parsed.kind === "error") {
    console.error(parsed.message);
    const { printHelp } = await import("./cli.js");
    printHelp();
    return 1;
  }

  if (parsed.kind === "completion") {
    return runCompletionCommand(parsed.shell);
  }

  const cwd = path.resolve(parsed.options.cwd);
  process.chdir(cwd);

  if (parsed.kind === "tasks") {
    return runTasksCommand({
      json: parsed.options.json,
      select: parsed.options.select,
      cwd,
    });
  }

  if (parsed.kind === "retro") {
    return runRetroCommand({ json: parsed.options.json });
  }

  if (parsed.kind === "tag") {
    return runTagCommand(parsed.rawArgs, { json: parsed.options.json });
  }

  const ctx = createCliContext(cwd, { autoConfirm: parsed.options.yes });

  if (parsed.kind === "rehydrate") {
    return runRehydrateCommand(parsed.workItemId, { json: parsed.options.json });
  }

  if (parsed.kind === "spec-gaps") {
    return runSpecGapsCommand(parsed.workItemId, { json: parsed.options.json });
  }

  if (parsed.kind === "init") {
    return runInitCommand(ctx, {
      json: parsed.options.json,
      write: parsed.options.write,
      target: parsed.options.target,
    });
  }

  if (parsed.kind === "config-init") {
    return runConfigInitCommand({
      json: parsed.options.json,
      write: parsed.options.write,
      yes: parsed.options.yes,
      force: parsed.options.force,
      defaultHarness: parsed.options.defaultHarness,
    });
  }

  if (parsed.kind === "plan") {
    return runPlanCommand(ctx, parsed.command, parsed.workItemId, { json: parsed.options.json });
  }

  let harnessSelection;
  try {
    harnessSelection = parseHarnessSelectionFromCli(parsed.options.harness, ctx);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    return 1;
  }

  const harness = createHarness(harnessSelection, ctx, {
    autoConfirm: parsed.options.yes,
    spawnNotifyLabel: parsed.kind,
    explicitSessionHarness: Boolean(parsed.options.harness?.trim()),
  });

  const driveOptions = {
    finish: parsed.options.finish,
    maxRounds: parsed.options.maxRounds,
    json: parsed.options.json,
  };

  if (parsed.kind === "run") {
    return runRunCommand(ctx, harness, parsed.text, driveOptions);
  }

  if (parsed.kind === "drive") {
    return runDriveCommand(ctx, harness, parsed.workItemId, driveOptions);
  }

  if (parsed.kind === "gaps") {
    return runGapsCommand(ctx, harness, parsed.workItemId, parsed.rawArgs, {
      json: parsed.options.json,
    });
  }

  if (parsed.kind === "deviations") {
    return runDeviationsCommand(ctx, harness, parsed.workItemId, parsed.rawArgs, {
      json: parsed.options.json,
    });
  }

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
