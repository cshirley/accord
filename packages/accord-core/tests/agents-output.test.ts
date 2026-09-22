import { describe, expect, test } from "bun:test";
import { getFinalOutput, getFinalOutputFromMessages, type PiMessage } from "../src/agents/output.js";

describe("getFinalOutputFromMessages", () => {
  test("uses last text block within the final assistant message", () => {
    const messages: PiMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "preamble without return packet" },
          {
            type: "text",
            text: 'done\n```json\n{"verdict":"clean","findings":[]}\n```',
          },
        ],
      },
    ];
    expect(getFinalOutputFromMessages(messages)).toContain('"verdict":"clean"');
  });
});

describe("getFinalOutput", () => {
  test("prefers streaming buffer when it alone contains the return fence", () => {
    const messages: PiMessage[] = [
      {
        role: "assistant",
        content: [{ type: "text", text: "short partial harvest" }],
      },
    ];
    const streamed = 'analysis\n```json\n{"verdict":"clean","findings":[]}\n```';
    expect(getFinalOutput(messages, streamed)).toBe(streamed);
  });
});
