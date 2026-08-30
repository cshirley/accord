import { describe, expect, test } from "bun:test";
import { planTaskPipelineProfile } from "../src/core/plan/task-pipeline-profile.js";

describe("planTaskPipelineProfile", () => {
  test("verify-only task skips TDD pipeline", () => {
    const profile = planTaskPipelineProfile([{ tag: "verify", description: "bunx nx test app" }]);
    expect(profile.verifyOnly).toBe(true);
    expect(profile.initialPhase).toBe("phase-verify-task");
    expect(profile.preImplGates).toBe("complete");
    expect(profile.hasTest).toBe(false);
    expect(profile.hasImpl).toBe(false);
  });

  test("mixed test+impl+verify uses standard phase-test entry", () => {
    const profile = planTaskPipelineProfile([
      { tag: "test", description: "write tests" },
      { tag: "impl", description: "implement" },
      { tag: "verify", description: "run tests" },
    ]);
    expect(profile.verifyOnly).toBe(false);
    expect(profile.initialPhase).toBe("phase-test");
    expect(profile.preImplGates).toBe("pending");
  });

  test("verify-only with multiple verify steps", () => {
    const profile = planTaskPipelineProfile([
      { tag: "verify", description: "typecheck" },
      { tag: "verify", description: "e2e" },
    ]);
    expect(profile.verifyOnly).toBe(true);
  });
});
