import { describe, expect, test } from "bun:test";
import type { Message } from "@earendil-works/pi-ai";
import {
  getFinalOutput,
  getFinalOutputFromMessages,
  hasHarvestedSubagentText,
  resolveSubagentChainPreviousOutput,
  resolveSubagentResultText,
  resolveSubagentSummaryPreview,
} from "../src/spawn/output.js";
import { SubagentRunError } from "../src/spawn/types.js";
import { spawnResultToSingle, subagentRunErrorToSingle } from "../src/tool/run-single.js";

describe("getFinalOutput", () => {
  test("returns last assistant text block from messages", () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "text", text: "first" }],
        timestamp: 0,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: "second" }],
        timestamp: 1,
      },
    ] as Message[];

    expect(getFinalOutputFromMessages(messages)).toBe("second");
    expect(getFinalOutput(messages)).toBe("second");
  });

  test("falls back to streaming text when final assistant content is empty", () => {
    const messages = [
      {
        role: "assistant",
        content: [],
        timestamp: 0,
      },
    ] as unknown as Message[];

    const streamed = 'Summary\n```json\n{"status":"done"}\n```';
    expect(getFinalOutput(messages)).toBe("");
    expect(getFinalOutput(messages, streamed)).toBe(streamed);
  });
});

describe("resolveSubagentResultText", () => {
  const emptyAssistantMessages = [
    {
      role: "assistant",
      content: [],
      timestamp: 0,
    },
  ] as unknown as Message[];

  test("prefers assistant message over output and streaming buffer", () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "text", text: "from message" }],
        timestamp: 0,
      },
    ] as Message[];

    expect(
      resolveSubagentResultText({
        messages,
        output: "from spawn output",
        liveActivity: { streamingText: "streamed" },
      }),
    ).toBe("from message");
  });

  test("uses output then streaming when messages are empty", () => {
    expect(
      resolveSubagentResultText({
        messages: emptyAssistantMessages,
        output: "from spawn output",
        liveActivity: { streamingText: "streamed" },
      }),
    ).toBe("from spawn output");

    expect(
      resolveSubagentResultText({
        messages: emptyAssistantMessages,
        output: "  from spawn output  ",
        liveActivity: { streamingText: "streamed" },
      }),
    ).toBe("from spawn output");

    expect(
      resolveSubagentResultText({
        messages: emptyAssistantMessages,
        output: "   ",
        liveActivity: { streamingText: "streamed only" },
      }),
    ).toBe("streamed only");

    expect(
      resolveSubagentResultText({
        messages: emptyAssistantMessages,
        liveActivity: { streamingText: "streamed only" },
      }),
    ).toBe("streamed only");
  });
});

describe("resolveSubagentChainPreviousOutput", () => {
  test("ignores spawn output field and prefers messages", () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "text", text: "chain step" }],
        timestamp: 0,
      },
    ] as Message[];

    expect(
      resolveSubagentChainPreviousOutput({
        messages,
        output: "truncated preview",
        liveActivity: { streamingText: "stream" },
      }),
    ).toBe("chain step");
  });

  test("falls back to streaming buffer without spawn output", () => {
    const messages = [
      {
        role: "assistant",
        content: [],
        timestamp: 0,
      },
    ] as unknown as Message[];

    expect(
      resolveSubagentChainPreviousOutput({
        messages,
        output: "should not use this",
        liveActivity: { streamingText: "full stream body" },
      }),
    ).toBe("full stream body");
  });

  test("does not use spawn output when messages and stream are empty", () => {
    const messages = [
      {
        role: "assistant",
        content: [],
        timestamp: 0,
      },
    ] as unknown as Message[];

    expect(
      resolveSubagentChainPreviousOutput({
        messages,
        output: "preview only",
      }),
    ).toBe("");
  });
});

describe("hasHarvestedSubagentText", () => {
  test("true when only spawn output is present", () => {
    expect(
      hasHarvestedSubagentText({
        messages: [{ role: "assistant", content: [], timestamp: 0 }] as unknown as Message[],
        output: "harvested only",
      }),
    ).toBe(true);
    expect(
      resolveSubagentSummaryPreview({
        messages: [{ role: "assistant", content: [], timestamp: 0 }] as unknown as Message[],
        output: "harvested only",
        exitCode: 0,
      }),
    ).toBe("harvested only");
  });
});

describe("resolveSubagentSummaryPreview", () => {
  test("does not echo stderr on failed run", () => {
    const messages = [
      {
        role: "assistant",
        content: [],
        timestamp: 0,
      },
    ] as unknown as Message[];

    expect(
      resolveSubagentSummaryPreview({
        messages,
        exitCode: 1,
        stopReason: "aborted",
        stderr: "SECRET=leak",
      }),
    ).toBe("(aborted)");
  });

  test("uses stopReason error without stderr", () => {
    expect(
      resolveSubagentSummaryPreview({
        messages: [],
        exitCode: 0,
        stopReason: "error",
        stderr: "ignored",
      }),
    ).toBe("(error)");
  });

  test("failed run with no signals returns generic failed", () => {
    expect(
      resolveSubagentSummaryPreview({
        messages: [],
        exitCode: 2,
      }),
    ).toBe("(failed)");

    expect(
      resolveSubagentSummaryPreview({
        messages: [],
        exitCode: 2,
        stderr: "SECRET=leak",
      }),
    ).toBe("(failed)");

    expect(
      resolveSubagentSummaryPreview({
        messages: [],
        exitCode: 2,
        errorMessage: "SECRET=leak",
      }),
    ).toBe("(failed)");
  });

  test("prefers harvested text over failure metadata", () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "text", text: "done" }],
        timestamp: 0,
      },
    ] as Message[];

    expect(
      resolveSubagentSummaryPreview({
        messages,
        exitCode: 0,
        stderr: "ignored",
      }),
    ).toBe("done");

    const failedWithText = [
      {
        role: "assistant",
        content: [{ type: "text", text: "partial result" }],
        timestamp: 0,
      },
    ] as Message[];

    expect(
      resolveSubagentSummaryPreview({
        messages: failedWithText,
        exitCode: 1,
        stopReason: "error",
        stderr: "SECRET=leak",
      }),
    ).toBe("partial result");
  });

  test("truncates long harvested previews at 100 characters", () => {
    const longText = "x".repeat(101);
    const messages = [
      {
        role: "assistant",
        content: [{ type: "text", text: longText }],
        timestamp: 0,
      },
    ] as Message[];

    expect(resolveSubagentSummaryPreview({ messages, exitCode: 0 })).toBe(`${"x".repeat(100)}...`);
    expect(resolveSubagentSummaryPreview({ messages, exitCode: 0 }).length).toBe(103);
  });
});

describe("subagentRunErrorToSingle", () => {
  test("preserves harvested output and live activity on thrown failures", () => {
    const error = new SubagentRunError(
      "timed out",
      {
        agent: "review-code",
        agentSource: "user",
        task: "t",
        exitCode: 1,
        messages: [],
        stderr: "SECRET=leak",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0,
          contextTokens: 0,
          turns: 0,
        },
        stopReason: "aborted",
        output: "partial harvest",
        liveActivity: { lines: [], streamingText: "partial harvest" },
      },
      "timeout",
    );

    const single = subagentRunErrorToSingle(error);
    expect(resolveSubagentResultText(single)).toBe("partial harvest");
    expect(resolveSubagentSummaryPreview(single)).toBe("partial harvest");
    expect(single.liveActivity?.streamingText).toBe("partial harvest");
    expect(single.stderr).toBe("SECRET=leak");
    expect(single.errorMessage).toBe("timed out");
    expect(single.exitCode).toBe(1);
    expect(single.agent).toBe("review-code");
    expect(single.task).toBe("t");
  });
});

describe("spawnResultToSingle output wiring", () => {
  test("preserves spawn output for resolveSubagentResultText", () => {
    const single = spawnResultToSingle({
      agent: "review-code",
      agentSource: "user",
      task: "t",
      exitCode: 0,
      messages: [],
      stderr: "",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        cost: 0,
        contextTokens: 0,
        turns: 0,
      },
      output: "harvested spawn text",
    });

    expect(resolveSubagentResultText(single)).toBe("harvested spawn text");
  });
});
