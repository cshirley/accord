import { describe, expect, test } from "bun:test";
import type { Message } from "@earendil-works/pi-ai";
import {
  formatOrchestratorSpawnStatusLines,
  registerOrchestratorSpawn,
  unregisterOrchestratorSpawn,
  updateOrchestratorSpawn,
} from "../packages/pi-subagent/src/orchestrator-spawn-status.js";
import {
  applyToolExecutionToMessages,
  formatOrchestratorProgressWidgetLines,
  formatToolCall,
  summarizeHarnessSubagentProgress,
} from "../packages/pi-subagent/src/progress.js";

describe("summarizeHarnessSubagentProgress", () => {
  test("extracts tool lines and turn count", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "tc1", name: "read", arguments: { path: "/tmp/foo.ts" } },
          { type: "text", text: "Reviewing ticket context." },
        ],
        api: "openai",
        provider: "openai",
        model: "gpt-test",
        usage: {
          input: 1,
          output: 2,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 3,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: 0,
      },
    ] as Message[];

    const summary = summarizeHarnessSubagentProgress("phase-gather", {
      messages,
      usage: { turns: 2 },
    });

    expect(summary.agent).toBe("phase-gather");
    expect(summary.turns).toBe(2);
    expect(summary.recentToolLines).toHaveLength(1);
    expect(summary.recentToolLines[0]).toContain("read ");
    expect(summary.recentToolLines[0]).toContain("foo.ts");
    expect(summary.textPreview).toBe("Reviewing ticket context.");
  });
});

describe("formatOrchestratorSpawnStatusLines", () => {
  test("shows turn count once progress is registered", () => {
    registerOrchestratorSpawn("run", { label: "Resume", agent: "phase-test" });
    updateOrchestratorSpawn("run", {
      agent: "phase-test",
      turns: 0,
      recentToolLines: [],
    });
    const lines = formatOrchestratorSpawnStatusLines();
    expect(lines.some((line) => line.includes("turn 0"))).toBe(true);
    unregisterOrchestratorSpawn("run");
  });

  test("lists multiple active spawns", () => {
    registerOrchestratorSpawn("a", { label: "Resume", agent: "phase-test" });
    registerOrchestratorSpawn("b", { label: "Resume", agent: "review-test" });
    updateOrchestratorSpawn("b", {
      agent: "review-test",
      turns: 2,
      recentToolLines: ["read ~/x.ts"],
      lastToolLine: "read ~/x.ts",
    });
    const lines = formatOrchestratorSpawnStatusLines();
    expect(lines[0]).toContain("2 running");
    expect(lines.some((line) => line.includes("phase-test"))).toBe(true);
    expect(lines.some((line) => line.includes("review-test"))).toBe(true);
    unregisterOrchestratorSpawn("a");
    unregisterOrchestratorSpawn("b");
    expect(formatOrchestratorSpawnStatusLines()).toEqual([]);
  });
});

describe("formatOrchestratorProgressWidgetLines", () => {
  test("includes agent, turn, and last tool line", () => {
    const lines = formatOrchestratorProgressWidgetLines("Resume", "phase-code", {
      agent: "phase-code",
      turns: 3,
      recentToolLines: ["read ~/src/a.ts", "edit ~/src/a.ts"],
      lastToolLine: "edit ~/src/a.ts",
    });
    expect(lines[0]).toContain("Resume");
    expect(lines[0]).toContain("phase-code");
    expect(lines[0]).toContain("turn 3");
    expect(lines[1]).toContain("edit");
  });
});

describe("applyToolExecutionToMessages", () => {
  test("adds tool call for progress summaries", () => {
    const messages: Message[] = [];
    applyToolExecutionToMessages(messages, "read", { path: "/tmp/a.ts" }, "tc-1");
    const summary = summarizeHarnessSubagentProgress("phase-test", {
      messages,
      usage: { turns: 0 },
    });
    expect(summary.lastToolLine).toContain("read ");
    expect(summary.lastToolLine).toContain("a.ts");
  });
});

describe("formatToolCall", () => {
  test("formats bash without theme", () => {
    const line = formatToolCall("bash", { command: "bun test" });
    expect(line).toContain("$ ");
    expect(line).toContain("bun test");
  });
});
