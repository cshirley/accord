import { describe, expect, test } from "bun:test";
import { applySubagentSpawnPayload } from "../src/subagent/payload.js";

describe("applySubagentSpawnPayload", () => {
  test("sets per-task agentFile in parallel mode without top-level agentFile", () => {
    const input: Record<string, unknown> = {
      tasks: [
        { agent: "review-code", task: "review diff A" },
        { agent: "review-security", task: "review diff B" },
      ],
    };

    applySubagentSpawnPayload(input, null);

    const tasks = input.tasks as { agent: string; agentFile?: string }[];
    expect(tasks[0]?.agentFile).toContain("review-code.md");
    expect(tasks[1]?.agentFile).toContain("review-security.md");
    expect(input.agentFile).toBeUndefined();
  });

  test("sets top-level agentFile for single-agent calls", () => {
    const input: Record<string, unknown> = {
      agent: "review-code",
      task: "review diff",
    };

    applySubagentSpawnPayload(input, null);

    expect(typeof input.agentFile).toBe("string");
    expect(String(input.agentFile)).toContain("review-code.md");
  });

  test("preserves caller-provided per-task agentFile and response", () => {
    const customFile = "/tmp/custom-review-code.md";
    const customResponse = { format: "markdown_section", title: "Custom", body: "x" };
    const input: Record<string, unknown> = {
      tasks: [
        {
          agent: "review-code",
          task: "review diff A",
          agentFile: customFile,
          response: customResponse,
        },
      ],
    };

    applySubagentSpawnPayload(input, null);

    const tasks = input.tasks as {
      agentFile?: string;
      response?: { title?: string };
    }[];
    expect(tasks[0]?.agentFile).toBe(customFile);
    expect(tasks[0]?.response?.title).toBe("Custom");
  });

  test("does not overwrite per-entry agentFile when top-level agentFile is set", () => {
    const topLevel = "/tmp/top-level-agent.md";
    const input: Record<string, unknown> = {
      agentFile: topLevel,
      chain: [
        { agent: "review-code", task: "step one" },
        { agent: "review-security", task: "step two" },
      ],
    };

    applySubagentSpawnPayload(input, null);

    const chain = input.chain as { agentFile?: string }[];
    expect(chain[0]?.agentFile).toBeUndefined();
    expect(chain[1]?.agentFile).toBeUndefined();
    expect(input.agentFile).toBe(topLevel);
  });

  test("does not overwrite per-entry response when top-level response is set", () => {
    const topLevel = { format: "instruction", instruction: "top-level only" };
    const input: Record<string, unknown> = {
      response: topLevel,
      tasks: [
        { agent: "review-code", task: "a" },
        { agent: "review-security", task: "b" },
      ],
    };

    applySubagentSpawnPayload(input, null);

    const tasks = input.tasks as { response?: { instruction?: string } }[];
    expect(tasks[0]?.response).toBeUndefined();
    expect(tasks[1]?.response).toBeUndefined();
    expect(input.response).toBe(topLevel);
  });

  test("sets per-task response in parallel mode without top-level response", () => {
    const input: Record<string, unknown> = {
      tasks: [
        { agent: "review-code", task: "review diff A" },
        { agent: "review-security", task: "review diff B" },
      ],
    };

    applySubagentSpawnPayload(input, null);

    const tasks = input.tasks as { agent: string; response?: { format: string } }[];
    expect(tasks[0]?.response?.format).toBe("json_schema_path");
    expect(tasks[1]?.response?.format).toBe("json_schema_path");
    expect(tasks[0]?.response).not.toBe(tasks[1]?.response);
    expect(input.response).toBeUndefined();
  });
});
