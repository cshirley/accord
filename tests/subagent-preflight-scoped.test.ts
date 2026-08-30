import { describe, expect, test } from "bun:test";
import {
  applyScopedPreflightWarnings,
  modelInScopedList,
  resolveJudgmentModelRefFromHarness,
} from "../src/core/queries/subagent-preflight-scoped.js";

describe("subagent preflight scoped diagnostics", () => {
  test("modelInScopedList matches provider and modelId", () => {
    const scoped = [{ provider: "anthropic", modelId: "claude-sonnet-4-6" }];
    expect(modelInScopedList("anthropic", "claude-sonnet-4-6", scoped)).toBe(true);
    expect(modelInScopedList("anthropic", "claude-opus-4-7", scoped)).toBe(false);
  });

  test("applyScopedPreflightWarnings adds spawn and judgment warnings", () => {
    const warnings: string[] = [];
    const scoped = [{ provider: "openai", modelId: "gpt-4o" }];
    applyScopedPreflightWarnings(
      warnings,
      { provider: "anthropic", model: "claude-opus-4-7" },
      scoped,
      { provider: "anthropic", model: "claude-haiku-4-5" },
    );
    expect(warnings.length).toBe(2);
    expect(warnings[0]).toContain("Spawn model");
    expect(warnings[1]).toContain("Judgment model");
  });

  test("resolveJudgmentModelRefFromHarness prefers config over lightweight tier", () => {
    const ref = resolveJudgmentModelRefFromHarness(
      { orchestration: { judgment: { model: "anthropic/claude-haiku-4-5" } } },
      { provider: "anthropic", model: "claude-sonnet-4-6" },
    );
    expect(ref).toEqual({ provider: "anthropic", model: "claude-haiku-4-5" });
  });

  test("resolveJudgmentModelRefFromHarness falls back to lightweight tier", () => {
    const ref = resolveJudgmentModelRefFromHarness(null, {
      provider: "anthropic",
      model: "claude-haiku-4-5",
    });
    expect(ref).toEqual({ provider: "anthropic", model: "claude-haiku-4-5" });
  });
});
