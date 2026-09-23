import { describe, expect, test } from "bun:test";

import {
  resultFromBackend,
  runPhase,
  type PhaseBackendResult,
  type PhaseRunBackend,
} from "../src/run-phase.js";

const DONE_PACKET = {
  status: "done",
  spec_path: "docs/dev/PROJ-1/spec.json",
};

function stubBackend(
  result: PhaseBackendResult,
  argvSeen: string[][] = [],
): { backend: PhaseRunBackend; argvSeen: string[][] } {
  const backend: PhaseRunBackend = async (opts) => {
    argvSeen.push([opts.phase, opts.ticket, ...(opts.extraArgs ?? [])]);
    return result;
  };
  return { backend, argvSeen };
}

describe("runPhase — backend routing (AC-6)", () => {
  test("invokes backend with phase + ticket", async () => {
    const { backend, argvSeen } = stubBackend({
      exitCode: 0,
      lastRun: { stopReason: "spawned_subagent", lastSpawn: { agent: "phase-spec", exitCode: 0, parsedReturn: DONE_PACKET } },
    });
    await runPhase({ phase: "spec", ticket: "PROJ-1", runBackend: backend });
    expect(argvSeen).toHaveLength(1);
    expect(argvSeen[0]).toEqual(["spec", "PROJ-1"]);
  });

  test("forwards extra allowlist flags via opts.extraArgs", async () => {
    const { backend, argvSeen } = stubBackend({
      exitCode: 0,
      lastRun: { stopReason: "spawned_subagent", lastSpawn: { agent: "phase-code", exitCode: 0, parsedReturn: DONE_PACKET } },
    });
    await runPhase({
      phase: "code",
      ticket: "PROJ-1",
      runBackend: backend,
      extraArgs: ["--task-id=2", "--owner-nonce=abc123"],
    });
    expect(argvSeen[0]).toEqual([
      "code",
      "PROJ-1",
      "--task-id=2",
      "--owner-nonce=abc123",
    ]);
  });
});

describe("runPhase — packet parsing", () => {
  test("returns the final return packet payload", async () => {
    const { backend } = stubBackend({
      exitCode: 0,
      lastRun: {
        stopReason: "spawned_subagent",
        lastSpawn: { agent: "phase-spec", exitCode: 0, parsedReturn: DONE_PACKET },
      },
    });
    const r = await runPhase({ phase: "spec", ticket: "PROJ-1", runBackend: backend });
    expect(r.status).toBe("done");
    if (r.status === "done") {
      expect(r.packet).toEqual(DONE_PACKET);
    }
  });

  test("maps stalledReason needs_input to needs_input status", async () => {
    const earlier = { status: "needs_input", questions: [{ id: "q1", topic: "t", text: "u" }] };
    const { backend } = stubBackend({
      exitCode: 2,
      stalledReason: "needs_input",
      lastRun: {
        stopReason: "spawned_subagent",
        lastSpawn: { agent: "phase-spec", exitCode: 0, parsedReturn: earlier },
      },
    });
    const r = await runPhase({ phase: "spec", ticket: "PROJ-1", runBackend: backend });
    expect(r.status).toBe("needs_input");
  });
});

describe("runPhase — truncated/stuck stream synthesis", () => {
  test("no return packet at all → status='stuck' with reason='no_return_packet'", async () => {
    const { backend } = stubBackend({
      exitCode: 0,
      lastRun: { stopReason: "idle" },
    });
    const r = await runPhase({ phase: "spec", ticket: "PROJ-1", runBackend: backend });
    expect(r.status).toBe("stuck");
    if (r.status === "stuck") {
      expect(r.reason).toBe("no_return_packet");
    }
  });

  test("non-zero exit code → status='stuck' with reason='subprocess_failed'", async () => {
    const { backend } = stubBackend({
      exitCode: 137,
      lastRun: {
        stopReason: "spawned_subagent",
        lastSpawn: { agent: "phase-spec", exitCode: 137, parsedReturn: DONE_PACKET },
      },
    });
    const r = await runPhase({ phase: "spec", ticket: "PROJ-1", runBackend: backend });
    expect(r.status).toBe("stuck");
    if (r.status === "stuck") {
      expect(r.reason).toBe("subprocess_failed");
    }
  });

  test("unsupported phase → stuck unsupported_phase", async () => {
    const r = await runPhase({ phase: "hax0r", ticket: "PROJ-1", runBackend: async () => ({ exitCode: 0 }) });
    expect(r.status).toBe("stuck");
    if (r.status === "stuck") {
      expect(r.reason).toBe("unsupported_phase");
    }
  });
});

describe("resultFromBackend — orchestration stop without spawn", () => {
  test("stopReason blocked with non-zero exit → blocked (not stuck)", () => {
    const r = resultFromBackend({
      exitCode: 1,
      lastRun: { stopReason: "blocked" },
    });
    expect(r.status).toBe("blocked");
  });

  test("stopReason complete without packet → done", () => {
    const r = resultFromBackend({
      exitCode: 0,
      lastRun: { stopReason: "complete" },
    });
    expect(r.status).toBe("done");
  });
});

describe("resultFromBackend — direct mapping", () => {
  test("prefers parsedReturn status over exit code", () => {
    const r = resultFromBackend({
      exitCode: 0,
      lastRun: {
        lastSpawn: { agent: "phase-spec", exitCode: 0, parsedReturn: { status: "gaps", gaps: [] } },
      },
    });
    expect(r.status).toBe("gaps");
  });
});
