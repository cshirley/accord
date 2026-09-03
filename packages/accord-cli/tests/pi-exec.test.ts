import { afterAll, describe, expect, mock, test } from "bun:test";
import * as path from "node:path";
import * as accordAgents from "@clive.shirley/accord-core/agents/index.js";
import { createHarness } from "../src/harnesses/registry.js";
import { runPiExec } from "../src/harnesses/pi-exec.js";
import { writeExecTaskFile } from "../src/harnesses/exec-template.js";
import { createCliContext } from "../src/context.js";

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");
const PHASE_ALIGN = path.join(
  REPO_ROOT,
  "packages/accord-assets/agents/accord/phase-align.md",
);

const spawnCalls: Array<Record<string, unknown>> = [];

const spawnSubagentMock = mock(async (params: Record<string, unknown>) => {
  spawnCalls.push(params);
  return {
    agent: String(params.agent ?? "phase-align"),
    agentSource: "explicit",
    agentFile: params.agentFile,
    task: params.task,
    exitCode: 0,
    messages: [],
    stderr: "",
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      cost: 0,
      contextTokens: 0,
      turns: 1,
    },
    model: "anthropic/claude-opus-4-7",
    output: 'done\n```json\n{"status":"done","summary":"mock"}\n```\n',
    parsedReturn: { status: "done", summary: "mock" },
  };
});

mock.module("@clive.shirley/accord-core/agents/index.js", () => ({
  ...accordAgents,
  spawnSubagent: spawnSubagentMock,
}));

afterAll(() => {
  mock.restore();
});

describe("pi harness registry", () => {
  test("createHarness(pi) returns built-in pi backend without pi-accord", () => {
    const ctx = createCliContext(process.cwd(), { autoConfirm: true });
    const harness = createHarness({ harnessId: "pi" }, ctx, { autoConfirm: true });
    expect(harness.id).toBe("pi");
  });
});

describe("pi exec spawn (mock)", () => {
  test("delegates to accord-core spawnSubagent with staged task file", async () => {
    spawnCalls.length = 0;
    const taskFile = writeExecTaskFile(process.cwd(), "phase-align", "Return packet smoke.");
    const result = await runPiExec({
      taskFile,
      agentFile: PHASE_ALIGN,
      agentId: "phase-align",
      cwd: process.cwd(),
    });

    expect(result.exitCode).toBe(0);
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0]?.agent).toBe("phase-align");
    expect(spawnCalls[0]?.agentFile).toBe(PHASE_ALIGN);
    expect(String(spawnCalls[0]?.task)).toContain("Return packet smoke.");
    expect(result.parsedReturn).toEqual({ status: "done", summary: "mock" });
  });
});
