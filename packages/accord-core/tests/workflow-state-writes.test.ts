import { afterEach, describe, expect, test } from "bun:test";
import { validateHarnessArtifactWriteIfApplicable } from "../src/harness/artifact-write.js";
import {
  classifyWorkflowStatePath,
  isOrchestratorOwnedWorkflowStatePath,
  validateWorkflowStateWrite,
} from "../src/harness/index.js";

describe("workflow state paths", () => {
  test("classifies orchestrator-owned paths", () => {
    expect(classifyWorkflowStatePath(".tasks/DEMO-1.json")).toBe("work_item");
    expect(classifyWorkflowStatePath(".tasks/DEMO-1-task-1.json")).toBe("task");
    expect(classifyWorkflowStatePath(".tasks/DEMO-1-checkpoint.json")).toBe("checkpoint");
    expect(classifyWorkflowStatePath(".tasks/DEMO-1-enrichments/jira.json")).toBe(
      "allowed_runtime",
    );
    expect(isOrchestratorOwnedWorkflowStatePath(".tasks/DEMO-1-task-2.json")).toBe(true);
  });
});

describe("workflow state write guard", () => {
  const previous = process.env.ACCORD_ALLOW_AGENT_WORKFLOW_WRITES;

  afterEach(() => {
    if (previous === undefined) delete process.env.ACCORD_ALLOW_AGENT_WORKFLOW_WRITES;
    else process.env.ACCORD_ALLOW_AGENT_WORKFLOW_WRITES = previous;
  });

  test("blocks work item writes by default", () => {
    delete process.env.ACCORD_ALLOW_AGENT_WORKFLOW_WRITES;
    const result = validateWorkflowStateWrite(".tasks/DEMO-1.json");
    expect(result.blocked).toBe(true);
  });

  test("allows legacy override", () => {
    process.env.ACCORD_ALLOW_AGENT_WORKFLOW_WRITES = "1";
    const result = validateWorkflowStateWrite(".tasks/DEMO-1.json");
    expect(result.blocked).toBe(false);
  });
});

// `applyTaskEventsFromPacket` (a standalone "merge events onto the primary task file"
// API) was removed with the v1 task file. Agent-reported events are now attached to the
// agent's own `log[]` entry as part of `record*` in `tasks/record.ts` (see
// `packetEvents`/`pushAgentLog`), invoked through the post-result handlers — there is no
// longer a separate apply-events step to unit test in isolation. Coverage: the T1
// phase-test `events[]` → `log[0].events` assertion in `task-trace-v2.test.ts`.

describe("artifact write hook integration", () => {
  test("validateHarnessArtifactWriteIfApplicable blocks workflow state writes", async () => {
    const previous = process.env.ACCORD_ALLOW_AGENT_WORKFLOW_WRITES;
    delete process.env.ACCORD_ALLOW_AGENT_WORKFLOW_WRITES;

    const result = await validateHarnessArtifactWriteIfApplicable(".tasks/DEMO-9.json");
    expect(result.skip).toBe(false);
    if (!result.skip) {
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("Orchestrator-owned workflow state");
    }

    if (previous === undefined) delete process.env.ACCORD_ALLOW_AGENT_WORKFLOW_WRITES;
    else process.env.ACCORD_ALLOW_AGENT_WORKFLOW_WRITES = previous;
  });
});
