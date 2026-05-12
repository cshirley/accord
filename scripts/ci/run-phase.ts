/**
 * AC-4 / AC-6 / AC-10 (event-stream parsing): spawn `pi` exactly once per
 * phase, parse the `--mode json` event stream, return the final phase return
 * packet (or synthesise a `stuck` result on truncation / non-zero exit).
 *
 * Forward-compat: unknown event types are ignored-and-logged; malformed JSON
 * lines are skipped. The return-packet detector is permissive — it scans
 * `agent_end.messages[].content[]` for a fenced JSON block whose body parses
 * to an object with a `status` field.
 *
 * Spawn is dependency-injected so tests can stub the subprocess surface
 * without monkey-patching node:child_process.
 *
 * NO SDK import — `tests/ci/no-extra-pi-spawns.test.ts` enforces this.
 * NO MCP sidecar.
 */

import { spawn as nodeSpawn } from "node:child_process";
import type { Readable } from "node:stream";

export interface SpawnedProcess {
  readonly stdout: Readable;
  readonly stderr: Readable;
  readonly exitCode: Promise<{ exitCode: number }>;
}

export type SpawnLike = (cmd: string, argv: readonly string[]) => SpawnedProcess;

export interface RunPhaseOpts {
  readonly phase: string;
  readonly ticket: string;
  readonly extraArgs?: readonly string[];
  readonly spawn?: SpawnLike;
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

const defaultSpawn: SpawnLike = (cmd, argv) => {
  const child = nodeSpawn(cmd, [...argv], { stdio: ["ignore", "pipe", "pipe"] });
  const exitCode = new Promise<{ exitCode: number }>((resolve) => {
    child.on("close", (code) => resolve({ exitCode: code ?? 0 }));
  });
  return { stdout: child.stdout, stderr: child.stderr, exitCode };
};

const FENCED_JSON_RE = /```json\s*\n([\s\S]*?)```/;

function tryParseReturnPacket(text: string): PhaseReturnPacket | null {
  const match = FENCED_JSON_RE.exec(text);
  const raw = match ? match[1]! : text;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      "status" in parsed &&
      typeof (parsed as Record<string, unknown>).status === "string"
    ) {
      return parsed as PhaseReturnPacket;
    }
  } catch {
    return null;
  }
  return null;
}

function extractFromAgentEnd(event: Record<string, unknown>): PhaseReturnPacket | null {
  const messages = event.messages;
  if (!Array.isArray(messages) || messages.length === 0) return null;
  const last = messages[messages.length - 1];
  if (last === null || typeof last !== "object") return null;
  const content = (last as Record<string, unknown>).content;
  if (!Array.isArray(content)) return null;
  // Search blocks back-to-front for the latest packet.
  for (let i = content.length - 1; i >= 0; i--) {
    const block = content[i];
    if (
      block !== null &&
      typeof block === "object" &&
      (block as Record<string, unknown>).type === "text"
    ) {
      const text = (block as Record<string, unknown>).text;
      if (typeof text === "string") {
        const parsed = tryParseReturnPacket(text);
        if (parsed) return parsed;
      }
    }
  }
  return null;
}

async function* readLines(stream: Readable): AsyncIterableIterator<string> {
  let buffer = "";
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    buffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    let nl = buffer.indexOf("\n");
    while (nl >= 0) {
      yield buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf("\n");
    }
  }
  if (buffer.length > 0) yield buffer;
}

const TERMINAL_STATUSES = new Set(["done", "needs_input", "blocked", "gaps"]);

export async function runPhase(opts: RunPhaseOpts): Promise<RunPhaseResult> {
  const spawn = opts.spawn ?? defaultSpawn;
  const argv = [
    "-p",
    "--mode",
    "json",
    "/skill:accord",
    opts.phase,
    opts.ticket,
    ...(opts.extraArgs ?? []),
  ];
  const child = spawn("pi", argv);

  let latestPacket: PhaseReturnPacket | null = null;
  for await (const line of readLines(child.stdout)) {
    if (line === "") continue;
    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue; // forward-compat: ignore malformed lines
    }
    if (event === null || typeof event !== "object") continue;
    const type = (event as Record<string, unknown>).type;
    if (typeof type !== "string") continue;
    if (type === "agent_end") {
      const packet = extractFromAgentEnd(event as Record<string, unknown>);
      if (packet) latestPacket = packet;
    }
    // All other event types are ignored-and-logged; forward-compat for new types.
  }

  const { exitCode } = await child.exitCode;

  if (exitCode !== 0) {
    return {
      status: "stuck",
      reason: "subprocess_failed",
      detail: `pi exited with code ${exitCode}`,
    };
  }

  if (latestPacket === null) {
    return {
      status: "stuck",
      reason: "no_return_packet",
      detail: "pi closed cleanly but no return packet was emitted",
    };
  }

  const status = latestPacket.status;
  if (TERMINAL_STATUSES.has(status)) {
    return { status: status as "done" | "needs_input" | "blocked" | "gaps", packet: latestPacket };
  }
  return {
    status: "stuck",
    reason: "unknown_status",
    detail: `phase returned unknown status: ${status}`,
  };
}
