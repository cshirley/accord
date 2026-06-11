import { describe, expect, test } from "bun:test";
import type { Message } from "@earendil-works/pi-ai";
import {
  getFinalOutput,
  getFinalOutputFromMessages,
} from "../packages/pi-subagent/src/spawn/output.js";

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
