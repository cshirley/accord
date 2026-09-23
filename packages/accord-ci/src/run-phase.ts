/**
 * AC-4 / AC-6 / AC-10: run one autopipeline phase via `accord-cli` (exec harness).
 *
 * Replaces the legacy `pi -p --mode json /dev <phase> <ticket>` subprocess.
 * Orchestration is delegated to `@clive.shirley/accord-cli` with `--harness exec`
 * (Claude Code / Cursor Agent backends from `~/.config/accord/accord.json`).
 *
 * Return packets are read from the last subagent spawn's `parsedReturn`. When the
 * orchestrator stalls without a packet, synthesises `stuck` with a reason.
 *
 * Dependency injection (`runBackend`) keeps unit tests free of real agent spawns.
 */

import { appendFile } from "node:fs/promises";

import {
  runDevSubcommandOrchestrationWithReplans,
  runFinishOrchestrationFromResolution,
  runResumeOrchestrationWithReplans,
} from "@clive.shirley/accord-core/orchestration/index.js";
import { resolveFinishOrchestration } from "@clive.shirley/accord-core/orchestration/resolve/finish.js";
import { extractReturnStatus } from "@clive.shirley/accord-core/orchestration/spawn-followup.js";
import type { RunUntilStopResult } from "@clive.shirley/accord-core/orchestration/types.js";
import { createCliContext } from "@clive.shirley/accord-cli/context.js";
import { asRuntimeHost } from "@clive.shirley/accord-cli/harnesses/as-runtime-host.js";
import {
  createHarness,
  parseHarnessSelectionFromCli,
} from "@clive.shirley/accord-cli/harnesses/registry.js";

export interface RunPhaseOpts {
  readonly phase: string;
  readonly ticket: string;
  readonly extraArgs?: readonly string[];
  readonly cwd?: string;
  readonly harness?: string;
  readonly runBackend?: PhaseRunBackend;
}

export interface PhaseReturnPacket {
  readonly status: string;
  readonly [key: string]: unknown;
}

export type RunPhaseResult =
  | {
      readonly status: "done" | "needs_input" | "blocked" | "gaps";
      readonly packet: PhaseReturnPacket;
    }
  | { readonly status: "stuck"; readonly reason: string; readonly detail?: string };

export interface PhaseBackendResult {
  readonly exitCode: number;
  readonly lastRun?: RunUntilStopResult;
  readonly stalledReason?: "repeat_spawn" | "needs_input";
}

export type PhaseRunBackend = (opts: RunPhaseOpts) => Promise<PhaseBackendResult>;

const TERMINAL_STATUSES = new Set(["done", "needs_input", "blocked", "gaps"]);

const WORKFLOW_SUBCOMMANDS = new Set(["align", "spec", "plan", "check"]);

function extraArgsToRaw(extraArgs?: readonly string[]): string {
  if (!extraArgs?.length) return "";
  return extraArgs
    .map((token) => (token.startsWith("--") ? token : `--${token}`))
    .join(" ");
}

function asPacket(parsedReturn: unknown): PhaseReturnPacket | null {
  if (
    parsedReturn !== null &&
    typeof parsedReturn === "object" &&
    "status" in parsedReturn &&
    typeof (parsedReturn as Record<string, unknown>).status === "string"
  ) {
    return parsedReturn as PhaseReturnPacket;
  }
  return null;
}

function synthesizePacket(
  status: string,
  stalledReason?: PhaseBackendResult["stalledReason"],
): PhaseReturnPacket {
  if (status === "needs_input") {
    return { status, questions: [] };
  }
  if (status === "blocked") {
    return {
      status,
      blockers: [{ reason: stalledReason ?? "orchestration_blocked" }],
    };
  }
  if (status === "gaps") {
    return { status, gaps: [] };
  }
  return { status };
}

export function resultFromBackend(backend: PhaseBackendResult): RunPhaseResult {
  const packet = asPacket(backend.lastRun?.lastSpawn?.parsedReturn);
  const extracted = packet?.status ?? extractReturnStatus(backend.lastRun?.lastSpawn?.parsedReturn);

  if (backend.stalledReason === "needs_input") {
    return {
      status: "needs_input",
      packet: packet ?? synthesizePacket("needs_input", backend.stalledReason),
    };
  }

  const orchestrationStop = backend.lastRun?.stopReason;
  if (orchestrationStop === "blocked") {
    return {
      status: "blocked",
      packet: packet ?? synthesizePacket("blocked", backend.stalledReason),
    };
  }
  if (orchestrationStop === "complete") {
    if (extracted && TERMINAL_STATUSES.has(extracted)) {
      return {
        status: extracted as "done" | "needs_input" | "blocked" | "gaps",
        packet: packet ?? synthesizePacket(extracted, backend.stalledReason),
      };
    }
    return {
      status: "done",
      packet: packet ?? synthesizePacket("done"),
    };
  }

  // Non-zero exit trumps any return packet (legacy pi subprocess semantics).
  if (backend.exitCode !== 0) {
    return {
      status: "stuck",
      reason: "subprocess_failed",
      detail: `accord exited with code ${backend.exitCode}`,
    };
  }

  if (extracted && TERMINAL_STATUSES.has(extracted)) {
    return {
      status: extracted as "done" | "needs_input" | "blocked" | "gaps",
      packet: packet ?? synthesizePacket(extracted, backend.stalledReason),
    };
  }

  if (!packet && !extracted) {
    return {
      status: "stuck",
      reason: "no_return_packet",
      detail: "accord closed cleanly but no return packet was emitted",
    };
  }

  return {
    status: "stuck",
    reason: "unknown_status",
    detail: `phase returned unknown status: ${extracted ?? "undefined"}`,
  };
}

async function defaultRunBackend(opts: RunPhaseOpts): Promise<PhaseBackendResult> {
  const cwd = opts.cwd ?? process.cwd();
  const harnessRaw = opts.harness ?? process.env.ACCORD_CI_HARNESS ?? "claude";
  const ctx = createCliContext(cwd, { autoConfirm: true });
  const harness = createHarness(parseHarnessSelectionFromCli(harnessRaw, ctx), ctx, {
    autoConfirm: true,
    spawnNotifyLabel: `phase-${opts.phase}`,
    explicitSessionHarness: true,
  });
  const rawArgs = extraArgsToRaw(opts.extraArgs);

  const host = asRuntimeHost(harness);

  if (WORKFLOW_SUBCOMMANDS.has(opts.phase)) {
    const result = await runDevSubcommandOrchestrationWithReplans(
      opts.phase,
      opts.ticket,
      rawArgs,
      ctx.devConfig,
      host,
    );
    const exit = result.lastRun.lastSpawn?.exitCode;
    return {
      exitCode: typeof exit === "number" && exit !== 0 ? exit : result.stalledReason ? 1 : 0,
      lastRun: result.lastRun,
      stalledReason: result.stalledReason,
    };
  }

  if (opts.phase === "code" || opts.phase === "resume") {
    const result = await runResumeOrchestrationWithReplans(
      opts.ticket,
      ctx.devConfig,
      host,
    );
    const exit = result.lastRun.lastSpawn?.exitCode;
    return {
      exitCode: typeof exit === "number" && exit !== 0 ? exit : result.stalledReason ? 1 : 0,
      lastRun: result.lastRun,
      stalledReason: result.stalledReason,
    };
  }

  if (opts.phase === "verify" || opts.phase === "finish") {
    const resolution = resolveFinishOrchestration(opts.ticket, ctx.devConfig);
    if (resolution.outcome === "blocked") {
      return { exitCode: 1, lastRun: { stopReason: "blocked" } };
    }
    const result = await runFinishOrchestrationFromResolution(
      resolution,
      opts.ticket,
      ctx.devConfig,
      host,
    );
    const exit = result.lastRun.lastSpawn?.exitCode;
    const closeoutFailed = result.closeout && !result.closeout.ok;
    return {
      exitCode: closeoutFailed ? 1 : typeof exit === "number" && exit !== 0 ? exit : 0,
      lastRun: result.lastRun,
    };
  }

  return {
    exitCode: 1,
    stalledReason: undefined,
  };
}

export async function runPhase(opts: RunPhaseOpts): Promise<RunPhaseResult> {
  const backend = opts.runBackend ?? defaultRunBackend;
  const phase = opts.phase.trim().toLowerCase();

  if (
    !WORKFLOW_SUBCOMMANDS.has(phase) &&
    phase !== "code" &&
    phase !== "verify" &&
    phase !== "resume" &&
    phase !== "finish"
  ) {
    return {
      status: "stuck",
      reason: "unsupported_phase",
      detail: `unsupported autopipeline phase: ${opts.phase}`,
    };
  }

  const backendResult = await backend({ ...opts, phase });
  return resultFromBackend(backendResult);
}

function parseArgv(argv: string[]): {
  phase?: string;
  ticket?: string;
  extraArgs: string[];
} {
  const extraArgs: string[] = [];
  let phase: string | undefined;
  let ticket: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--phase") {
      phase = argv[++i];
      continue;
    }
    if (token.startsWith("--phase=")) {
      phase = token.slice("--phase=".length);
      continue;
    }
    if (token === "--ticket") {
      ticket = argv[++i];
      continue;
    }
    if (token.startsWith("--ticket=")) {
      ticket = token.slice("--ticket=".length);
      continue;
    }
    extraArgs.push(token);
  }

  return { phase, ticket, extraArgs };
}

async function writeGithubOutput(result: RunPhaseResult): Promise<void> {
  const githubOutput = process.env.GITHUB_OUTPUT;
  const status = result.status;
  if (githubOutput) {
    await appendFile(githubOutput, `status=${status}\n`);
  } else {
    process.stdout.write(`status=${status}\n`);
  }
}

async function main(argv: string[]): Promise<number> {
  const { phase, ticket, extraArgs } = parseArgv(argv);
  if (!phase || !ticket) {
    process.stderr.write("usage: run-phase.ts --phase <name> --ticket <KEY> [--task-id=N ...]\n");
    return 1;
  }

  const result = await runPhase({ phase, ticket, extraArgs });
  await writeGithubOutput(result);

  if (result.status === "stuck") {
    process.stderr.write(`${result.reason}${result.detail ? `: ${result.detail}` : ""}\n`);
    return 1;
  }
  return 0;
}

if (import.meta.main) {
  void main(process.argv.slice(2)).then((code) => process.exit(code));
}
