import { describe, expect, test } from "bun:test";
import { Readable } from "node:stream";

import { runPhase, type SpawnLike } from "../../scripts/ci/run-phase.js";

function makeSpawnStub(
  stdoutLines: string[],
  opts: { closeCleanly?: boolean } = {},
): {
  spawn: SpawnLike;
  argvSeen: string[][];
} {
  const argvSeen: string[][] = [];
  const spawn: SpawnLike = (cmd, argv) => {
    argvSeen.push([cmd, ...argv]);
    const stdout = Readable.from(
      (async function* () {
        for (const line of stdoutLines) {
          yield `${line}\n`;
        }
      })(),
    );
    const stderr = Readable.from((async function* () {})());
    const promise = new Promise<{ exitCode: number }>((resolve) => {
      stdout.on("end", () => resolve({ exitCode: opts.closeCleanly === false ? 137 : 0 }));
    });
    return { stdout, stderr, exitCode: promise };
  };
  return { spawn, argvSeen };
}

const SESSION_HEADER = JSON.stringify({
  type: "session",
  version: 3,
  id: "u",
  timestamp: "",
  cwd: "/",
});

const DONE_PACKET = {
  status: "done",
  spec_path: "docs/dev/PROJ-1/spec.json",
  usage: { prompt_tokens: 100, completion_tokens: 50 },
};

function returnPacketEvent(packet: object): string {
  // The phase return packet is the last assistant message's text content.
  return JSON.stringify({
    type: "agent_end",
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text: `\`\`\`json\n${JSON.stringify(packet)}\n\`\`\`` }],
      },
    ],
  });
}

describe("runPhase — argv (AC-6)", () => {
  test("spawns exactly `pi -p --mode json /skill:accord <phase> <ticket>`", async () => {
    const { spawn, argvSeen } = makeSpawnStub([SESSION_HEADER, returnPacketEvent(DONE_PACKET)]);
    await runPhase({ phase: "spec", ticket: "PROJ-1", spawn });
    expect(argvSeen).toHaveLength(1);
    expect(argvSeen[0]).toEqual(["pi", "-p", "--mode", "json", "/skill:accord", "spec", "PROJ-1"]);
  });

  test("supports extra allowlist flags via opts.extraArgs", async () => {
    const { spawn, argvSeen } = makeSpawnStub([SESSION_HEADER, returnPacketEvent(DONE_PACKET)]);
    await runPhase({
      phase: "code",
      ticket: "PROJ-1",
      spawn,
      extraArgs: ["--task-id=2", "--owner-nonce=abc123"],
    });
    expect(argvSeen[0]).toEqual([
      "pi",
      "-p",
      "--mode",
      "json",
      "/skill:accord",
      "code",
      "PROJ-1",
      "--task-id=2",
      "--owner-nonce=abc123",
    ]);
  });
});

describe("runPhase — packet parsing", () => {
  test("returns the final return packet payload", async () => {
    const { spawn } = makeSpawnStub([SESSION_HEADER, returnPacketEvent(DONE_PACKET)]);
    const r = await runPhase({ phase: "spec", ticket: "PROJ-1", spawn });
    expect(r.status).toBe("done");
    if (r.status === "done") {
      expect(r.packet).toEqual(DONE_PACKET);
    }
  });

  test("ignores-and-logs unknown event types (forward-compat)", async () => {
    const lines = [
      SESSION_HEADER,
      JSON.stringify({ type: "future_event_not_yet_defined", payload: { x: 1 } }),
      JSON.stringify({ type: "agent_start" }),
      JSON.stringify({ type: "turn_start" }),
      JSON.stringify({ type: "another_unknown_type" }),
      returnPacketEvent(DONE_PACKET),
    ];
    const { spawn } = makeSpawnStub(lines);
    const r = await runPhase({ phase: "spec", ticket: "PROJ-1", spawn });
    expect(r.status).toBe("done");
  });

  test("ignores malformed JSON lines (forward-compat)", async () => {
    const lines = [
      SESSION_HEADER,
      "not-json-at-all",
      JSON.stringify({ type: "agent_start" }),
      returnPacketEvent(DONE_PACKET),
    ];
    const { spawn } = makeSpawnStub(lines);
    const r = await runPhase({ phase: "spec", ticket: "PROJ-1", spawn });
    expect(r.status).toBe("done");
  });

  test("multiple return packets → keeps the LAST one (convention)", async () => {
    const earlier = { status: "needs_input", questions: [{ id: "q1", topic: "t", text: "u" }] };
    const lines = [SESSION_HEADER, returnPacketEvent(earlier), returnPacketEvent(DONE_PACKET)];
    const { spawn } = makeSpawnStub(lines);
    const r = await runPhase({ phase: "spec", ticket: "PROJ-1", spawn });
    expect(r.status).toBe("done");
  });
});

describe("runPhase — truncated/stuck stream synthesis", () => {
  test("no return packet at all → status='stuck' with reason='no_return_packet'", async () => {
    const lines = [SESSION_HEADER, JSON.stringify({ type: "agent_start" })];
    const { spawn } = makeSpawnStub(lines);
    const r = await runPhase({ phase: "spec", ticket: "PROJ-1", spawn });
    expect(r.status).toBe("stuck");
    if (r.status === "stuck") {
      expect(r.reason).toBe("no_return_packet");
    }
  });

  test("non-zero exit code with a return packet → status='stuck' with reason='subprocess_failed'", async () => {
    const lines = [SESSION_HEADER, returnPacketEvent(DONE_PACKET)];
    const { spawn } = makeSpawnStub(lines, { closeCleanly: false });
    const r = await runPhase({ phase: "spec", ticket: "PROJ-1", spawn });
    expect(r.status).toBe("stuck");
    if (r.status === "stuck") {
      expect(r.reason).toBe("subprocess_failed");
    }
  });
});
