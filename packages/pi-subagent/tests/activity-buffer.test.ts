import { describe, expect, test } from "bun:test";
import { SubagentActivityBuffer } from "../src/progress/activity-buffer.js";
import { HARVEST_STREAM_MAX, TEXT_PREVIEW_MAX } from "../src/progress/types.js";

describe("SubagentActivityBuffer streaming retention", () => {
  test("retains streamed text beyond legacy preview cap for harvest", () => {
    const buffer = new SubagentActivityBuffer();
    const chunk = "z".repeat(TEXT_PREVIEW_MAX * 4);
    buffer.onTextDelta(chunk);
    const marker = "HARVEST_TAIL_MARKER";
    buffer.onTextDelta(marker);

    const snapshot = buffer.snapshot();
    expect(snapshot.streamingText).toContain(marker);
    expect(snapshot.streamingText?.length).toBeGreaterThan(TEXT_PREVIEW_MAX * 2);
  });

  test("truncates at HARVEST_STREAM_MAX from the tail", () => {
    const buffer = new SubagentActivityBuffer();
    const oversized = "a".repeat(HARVEST_STREAM_MAX + 500);
    buffer.onTextDelta(oversized);
    const tail = "END_OF_STREAM";
    buffer.onTextDelta(tail);

    const snapshot = buffer.snapshot();
    expect(snapshot.streamingText).toContain(tail);
    expect(snapshot.streamingText?.length).toBeLessThanOrEqual(HARVEST_STREAM_MAX);
  });
});
