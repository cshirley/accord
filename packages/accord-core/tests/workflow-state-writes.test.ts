import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { validateHarnessArtifactWriteIfApplicable } from "../src/harness/artifact-write.js";
import {
  applyTaskEventsFromPacket,
  classifyWorkflowStatePath,
  isOrchestratorOwnedWorkflowStatePath,
  validateWorkflowStateWrite,
} from "../src/harness/index.js";
import { workItemJsonPath, writeJson } from "../src/work-items/io.js";

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

describe("applyTaskEventsFromPacket", () => {
  let tempRoot = "";

  afterEach(() => {
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = "";
  });

  test("merges events from return packet onto primary task file", () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "accord-wi-"));
    const tasksDir = path.join(tempRoot, ".tasks");
    fs.mkdirSync(tasksDir, { recursive: true });
    const previousCwd = process.cwd();
    process.chdir(tempRoot);

    try {
      writeJson(workItemJsonPath("DEMO-1"), {
        schema_version: "1.0",
        id: "DEMO-1",
        title: "Test",
        created: "2026-01-01T00:00:00Z",
        updated: "2026-01-01T00:00:00Z",
        pattern: "implement",
        phase: "implementing",
        spec: null,
        plan: null,
        verify: null,
        brief: null,
        task_ids: [1],
        decisions: [],
        deviations: [],
        cost_usd: 0,
      });
      writeJson(path.join(tasksDir, "DEMO-1-task-1.json"), {
        schema_version: "1.0",
        work_item_id: "DEMO-1",
        task_id: 1,
        owner_nonce: "abc123",
        phase: "phase-test",
        status: "pending",
        pre_impl_gates: "pending",
        events: [],
      });

      const applied = applyTaskEventsFromPacket("DEMO-1", {
        events: [
          {
            type: "deviation",
            at: "2026-01-01T00:00:00Z",
            description: "renamed helper",
            reason: "clarity",
          },
        ],
      });
      expect(applied).toBe(true);

      const task = JSON.parse(
        fs.readFileSync(path.join(tasksDir, "DEMO-1-task-1.json"), "utf8"),
      ) as { events: unknown[] };
      expect(task.events).toHaveLength(1);
    } finally {
      process.chdir(previousCwd);
    }
  });
});

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
