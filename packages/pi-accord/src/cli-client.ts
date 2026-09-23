/**
 * Pi extension client for the standalone `accord` orchestrator commands.
 *
 * Default: in-process {@link @clive.shirley/accord-cli} with the Pi extension harness (TUI).
 * Set `ACCORD_CLI_DELEGATE=subprocess` to spawn `accord` as a child process instead.
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  createCliContextFromHarnessState,
  type FinishCommandResult,
  type ResumeCommandResult,
  runFinishCommand,
  runResumeCommand,
  runSubcommandCommand,
  type SubcommandCommandResult,
} from "@clive.shirley/accord-cli";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { HookState } from "./hook-state.js";
import { createPiExtensionHarness } from "./pi-extension-harness.js";

const require = createRequire(import.meta.url);

export type PiCliDelegateMode = "in-process" | "subprocess";

export function resolvePiCliDelegateMode(): PiCliDelegateMode {
  const raw = process.env.ACCORD_CLI_DELEGATE?.trim().toLowerCase();
  if (raw === "subprocess" || raw === "1" || raw === "true") {
    return "subprocess";
  }
  return "in-process";
}

function resolveAccordCliEntry(): string {
  const override = process.env.ACCORD_CLI_BIN?.trim();
  if (override) {
    return override;
  }
  return require.resolve("@clive.shirley/accord-cli/src/main.ts");
}

function buildAccordArgv(
  subcommand: string,
  workItemId: string,
  options?: { harness?: string; extraArgs?: string[] },
): string[] {
  const argv = [subcommand, workItemId];
  if (options?.harness) {
    argv.push("--harness", options.harness);
  }
  if (options?.extraArgs?.length) {
    argv.push(...options.extraArgs);
  }
  argv.push("--cwd", process.cwd());
  return argv;
}

export async function runAccordCliSubprocess(
  subcommand: string,
  workItemId: string,
  options?: { harness?: string; extraArgs?: string[] },
): Promise<number> {
  const entry = resolveAccordCliEntry();
  const argv = buildAccordArgv(subcommand, workItemId, {
    harness: options?.harness ?? "pi",
    extraArgs: options?.extraArgs,
  });

  const runner = entry.endsWith(".ts") ? process.execPath : entry;
  const runnerArgs = entry.endsWith(".ts") ? [entry, ...argv] : argv;

  return new Promise((resolve, reject) => {
    const child = spawn(runner, runnerArgs, {
      cwd: process.cwd(),
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

export function createPiCliContext(ctx: ExtensionCommandContext, state: HookState) {
  return createCliContextFromHarnessState(ctx.cwd, state);
}

export function createPiCliHarness(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  state: HookState,
  options: { spawnNotifyLabel?: string },
) {
  return createPiExtensionHarness(pi, ctx, state, options);
}

export async function delegateResumeViaAccordCli(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  state: HookState,
  workItemId: string,
  options: { spawnNotifyLabel?: string },
): Promise<ResumeCommandResult> {
  if (resolvePiCliDelegateMode() === "subprocess") {
    const exitCode = await runAccordCliSubprocess("resume", workItemId, { harness: "pi" });
    return { exitCode };
  }

  const cliCtx = createPiCliContext(ctx, state);
  const harness = createPiCliHarness(pi, ctx, state, options);
  return runResumeCommand(cliCtx, harness, workItemId);
}

export async function delegateFinishViaAccordCli(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  state: HookState,
  workItemId: string,
  options: { spawnNotifyLabel?: string },
): Promise<FinishCommandResult> {
  if (resolvePiCliDelegateMode() === "subprocess") {
    const exitCode = await runAccordCliSubprocess("finish", workItemId, { harness: "pi" });
    return { exitCode };
  }

  const cliCtx = createPiCliContext(ctx, state);
  const harness = createPiCliHarness(pi, ctx, state, options);
  return runFinishCommand(cliCtx, harness, workItemId);
}

export async function delegateSubcommandViaAccordCli(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  state: HookState,
  subcommand: string,
  workItemId: string,
  rawArgs: string,
  options: { spawnNotifyLabel?: string },
): Promise<SubcommandCommandResult> {
  if (resolvePiCliDelegateMode() === "subprocess") {
    const extraArgs = rawArgs.trim().length > 0 ? rawArgs.trim().split(/\s+/) : [];
    const exitCode = await runAccordCliSubprocess(subcommand, workItemId, {
      harness: "pi",
      extraArgs,
    });
    return { exitCode };
  }

  const cliCtx = createPiCliContext(ctx, state);
  const harness = createPiCliHarness(pi, ctx, state, options);
  return runSubcommandCommand(cliCtx, harness, subcommand, workItemId, rawArgs);
}
