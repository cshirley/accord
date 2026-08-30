import { describe, expect, test } from "bun:test";
import {
  extractJsonObjectFromModelText,
  mergeResumeTaskWithJudgment,
  validateOrchestrationJudgmentPacket,
} from "../src/core/orchestration/judgment.js";

describe("orchestration judgment packet", () => {
  test("accepts minimal valid packet", () => {
    const v = validateOrchestrationJudgmentPacket({
      schema_version: "1.0",
      brief_appendix: "Double-check null handling in the red path.",
    });
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.value.brief_appendix).toContain("null");
    }
  });

  test("rejects forbidden routing keys", () => {
    const v = validateOrchestrationJudgmentPacket({
      schema_version: "1.0",
      brief_appendix: "x",
      agent: "phase-code",
    });
    expect(v.ok).toBe(false);
  });

  test("rejects extra top-level keys", () => {
    const v = validateOrchestrationJudgmentPacket({
      schema_version: "1.0",
      brief_appendix: "ok",
      next_agent: "bad",
    });
    expect(v.ok).toBe(false);
  });

  test("merge uses template when raw is garbage", () => {
    const base = "BASE TASK";
    const merged = mergeResumeTaskWithJudgment({
      baseTask: base,
      rawLlmText: "not json {{{",
      workItemId: "WI-1",
      dispatchAgent: "review-test",
    });
    expect(merged.startsWith(base)).toBe(true);
    expect(merged).toContain("Judgment supplement (harness — template)");
    expect(merged).toContain("WI-1");
  });

  test("merge uses template when raw is undefined", () => {
    const merged = mergeResumeTaskWithJudgment({
      baseTask: "BASE",
      rawLlmText: undefined,
      workItemId: "WI-2",
      dispatchAgent: "phase-test",
    });
    expect(merged).toContain("Judgment supplement (harness — template)");
  });

  test("merge embeds validated appendix from fenced JSON", () => {
    const raw = [
      "```json",
      JSON.stringify({
        schema_version: "1.0",
        brief_appendix: "Focus on edge cases for empty input.",
        focus_points: ["Case A", "Case B"],
      }),
      "```",
    ].join("\n");
    const merged = mergeResumeTaskWithJudgment({
      baseTask: "BASE",
      rawLlmText: raw,
      workItemId: "WI-3",
      dispatchAgent: "review-test",
    });
    expect(merged).toContain("## Judgment supplement (harness)");
    expect(merged).toContain("Focus on edge cases");
    expect(merged).toContain("### Focus");
    expect(merged).toContain("- Case A");
  });

  test("extractJsonObjectFromModelText handles prose before JSON", () => {
    const extracted = extractJsonObjectFromModelText(
      'Here you go: {"schema_version":"1.0","brief_appendix":"x"} thanks',
    );
    expect(extracted).toEqual({ schema_version: "1.0", brief_appendix: "x" });
  });
});

describe("orchestration judgment fuzz", () => {
  test("oversized brief_appendix fails validation → template merge", () => {
    const huge = "y".repeat(9000);
    const raw = JSON.stringify({ schema_version: "1.0", brief_appendix: huge });
    const merged = mergeResumeTaskWithJudgment({
      baseTask: "BASE",
      rawLlmText: raw,
      workItemId: "WI-Z",
      dispatchAgent: "review-test",
    });
    expect(merged).toContain("Judgment supplement (harness — template)");
  });

  test("random strings yield deterministic merge (template when invalid)", () => {
    for (let round = 0; round < 40; round++) {
      const noise = `@@${round}@@${Math.random().toString(36).slice(2)}`;
      const merged = mergeResumeTaskWithJudgment({
        baseTask: "BASE",
        rawLlmText: noise,
        workItemId: "WI-FUZZ",
        dispatchAgent: "review-test",
      });
      expect(merged.startsWith("BASE")).toBe(true);
      expect(merged).toContain("Judgment supplement (harness — template)");
    }
  });
});
