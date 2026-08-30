import { afterEach, describe, expect, test } from "bun:test";
import type { Message } from "@earendil-works/pi-ai";
import {
  applyToolExecutionToMessages,
  extractToolOutputPreview,
  formatToolCall,
  isSubagentStderrNoise,
  mergeActivityWithToolLines,
  SubagentActivityBuffer,
  summarizeSubagentProgress,
} from "../../pi-subagent/src/api.js";
import {
  formatOrchestratorSpawnStatusLines,
  registerOrchestratorSpawn,
  unregisterOrchestratorSpawn,
  updateOrchestratorSpawn,
} from "../src/adapters/pi/subagent/spawn-status.js";
import {
  formatOrchestratorProgressWidgetLines,
  formatOrchestratorSpawnElapsed,
  formatOrchestratorStallHint,
} from "../src/adapters/pi/subagent/spawn-ui.js";

describe("summarizeSubagentProgress", () => {
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

    const summary = summarizeSubagentProgress("phase-gather", {
      messages,
      usage: { turns: 2 },
    });

    expect(summary.agent).toBe("phase-gather");
    expect(summary.turns).toBe(2);
    expect(summary.activityLines).toHaveLength(1);
    expect(summary.recentToolLines).toHaveLength(1);
    expect(summary.recentToolLines[0]).toContain("read ");
    expect(summary.recentToolLines[0]).toContain("foo.ts");
    expect(summary.textPreview).toBe("Reviewing ticket context.");
  });
});

describe("formatOrchestratorSpawnStatusLines", () => {
  afterEach(() => {
    for (const id of ["run", "a", "b"]) {
      unregisterOrchestratorSpawn(id);
    }
  });

  test("shows turn count once progress is registered", () => {
    registerOrchestratorSpawn("run", { label: "Resume", agent: "phase-test" });
    updateOrchestratorSpawn("run", {
      agent: "phase-test",
      turns: 0,
      recentToolLines: [],
      activityLines: ["turn 1 started"],
    });
    const lines = formatOrchestratorSpawnStatusLines();
    expect(lines.some((line) => line.includes("turn 1 started"))).toBe(true);
    expect(lines.some((line) => /\d+s/.test(line) || line.includes("starting"))).toBe(true);
    unregisterOrchestratorSpawn("run");
  });

  test("lists multiple active spawns", () => {
    unregisterOrchestratorSpawn("run");
    registerOrchestratorSpawn("a", { label: "Resume", agent: "phase-test" });
    registerOrchestratorSpawn("b", { label: "Resume", agent: "review-test" });
    updateOrchestratorSpawn("b", {
      agent: "review-test",
      turns: 2,
      recentToolLines: ["read ~/x.ts"],
      activityLines: ["read ~/x.ts"],
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
      activityLines: ["read ~/src/a.ts", "edit ~/src/a.ts"],
      lastToolLine: "edit ~/src/a.ts",
    });
    expect(lines[0]).toContain("Resume");
    expect(lines[0]).toContain("phase-code");
    expect(lines[0]).toContain("turn 3");
    expect(lines.some((line) => line.includes("edit"))).toBe(true);
  });
});

describe("applyToolExecutionToMessages", () => {
  test("adds tool call for progress summaries", () => {
    const messages: Message[] = [];
    applyToolExecutionToMessages(messages, "read", { path: "/tmp/a.ts" }, "tc-1");
    const summary = summarizeSubagentProgress("phase-test", {
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

describe("mergeActivityWithToolLines", () => {
  test("includes tool lines when activity buffer only has status strings", () => {
    const merged = mergeActivityWithToolLines(
      ["subagent process started", "turn 1 started"],
      ["read ~/src/foo.ts", "$ bun test"],
    );
    expect(merged.some((line) => line.includes("read "))).toBe(true);
    expect(merged.some((line) => line.includes("bun test"))).toBe(true);
  });
});

describe("summarizeSubagentProgress with live activity", () => {
  test("merges message tool lines when live buffer lacks them", () => {
    const messages = [
      {
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "tc1",
            name: "read",
            arguments: { path: "/tmp/foo.ts" },
          },
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
    ] as import("@earendil-works/pi-ai").Message[];

    const summary = summarizeSubagentProgress("phase-test", {
      messages,
      usage: { turns: 1 },
      liveActivity: { lines: ["turn 1 started"] },
    });
    expect(summary.activityLines.some((line) => line.includes("read "))).toBe(true);
    expect(summary.activityLines.some((line) => line.includes("foo.ts"))).toBe(true);
  });
});

describe("SubagentActivityBuffer", () => {
  test("applyAssistantMessageEvent records toolcall_start", () => {
    const buffer = new SubagentActivityBuffer();
    const messages: import("@earendil-works/pi-ai").Message[] = [];
    buffer.applyAssistantMessageEvent(
      {
        type: "toolcall_start",
        toolCall: {
          type: "toolCall",
          id: "tc-1",
          name: "bash",
          arguments: { command: "bun test" },
        },
      },
      messages,
    );
    const snap = buffer.snapshot();
    expect(snap.lines.some((line) => line.includes("bun test"))).toBe(true);
    expect(messages.length).toBeGreaterThan(0);
  });
  test("records tool start, streaming output, and completion", () => {
    const buffer = new SubagentActivityBuffer();
    buffer.onToolStart("bash", { command: "bun test" });
    buffer.onToolUpdate("bash", {
      content: [{ type: "text", text: "pass 1\npass 2\n" }],
    });
    buffer.onToolEnd("bash", { command: "bun test" }, false);
    const snap = buffer.snapshot();
    expect(snap.lines.some((line) => line.includes("bun test"))).toBe(true);
    expect(snap.lines.some((line) => line.includes("pass 2"))).toBe(true);
    expect(snap.lines.at(-1)).toContain("(done)");
  });
});

describe("extractToolOutputPreview", () => {
  test("returns tail of text content blocks", () => {
    const preview = extractToolOutputPreview({
      content: [{ type: "text", text: "line one\nline two\nline three" }],
    });
    expect(preview).toContain("line three");
  });
});

describe("formatOrchestratorSpawnElapsed", () => {
  test("formats seconds and minutes", () => {
    const start = 1_000_000;
    expect(formatOrchestratorSpawnElapsed(start, start + 12_000)).toBe("12s");
    expect(formatOrchestratorSpawnElapsed(start, start + 125_000)).toBe("2m 05s");
  });
});

describe("isSubagentStderrNoise", () => {
  test("filters extension bootstrap stderr", () => {
    expect(isSubagentStderrNoise("📓 Journal tools loaded: journal-read-entry")).toBe(true);
    expect(isSubagentStderrNoise("🔗 Tools loaded: 14 tools, 3 services")).toBe(true);
    expect(isSubagentStderrNoise("actual error: connection refused")).toBe(false);
  });
});

describe("formatOrchestratorStallHint", () => {
  test("shows waiting hint after idle period without tools", () => {
    const startedAt = Date.now() - 8_000;
    const hint = formatOrchestratorStallHint(
      {
        agent: "phase-test",
        turns: 0,
        recentToolLines: [],
        activityLines: ["turn 1 started"],
      },
      startedAt,
    );
    expect(hint).toBe("waiting for model response…");
  });

  test("shows composing hint when text is streaming", () => {
    const startedAt = Date.now() - 8_000;
    const hint = formatOrchestratorStallHint(
      {
        agent: "phase-test",
        turns: 0,
        recentToolLines: [],
        activityLines: ["turn 1 started"],
        textPreview: "Reviewing acceptance criteria for AC-2",
      },
      startedAt,
    );
    expect(hint).toContain("composing…");
    expect(hint).toContain("AC-2");
  });
});

describe("SubagentActivityBuffer stderr eviction", () => {
  test("keeps tool lines when many status lines are pushed", () => {
    const buffer = new SubagentActivityBuffer();
    for (let statusIndex = 0; statusIndex < 8; statusIndex++) {
      buffer.pushStatus(`status line ${String(statusIndex)}`);
    }
    buffer.onToolStart("read", { path: "/tmp/foo.ts" });
    const snap = buffer.snapshot();
    expect(snap.lines.some((line) => line.includes("read "))).toBe(true);
    expect(snap.lines.some((line) => line.includes("foo.ts"))).toBe(true);
  });
});
