import { describe, expect, test } from "bun:test";
import { applyWorkflowStateFromValidatedReturn } from "../src/harness/workflow-state-apply.js";

describe("applyWorkflowStateFromValidatedReturn", () => {
  test("returns empty string when work item is missing", () => {
    const append = applyWorkflowStateFromValidatedReturn({
      workItemId: "MISSING-999",
      agent: "phase-align",
      packet: { status: "done" },
      devConfig: null,
    });
    expect(append).toBe("");
  });
});
