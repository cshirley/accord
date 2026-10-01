import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildWorkItemTrace,
  TRACE_EXCERPT_MAX_CHARS,
  writeWorkItemTrace,
} from "@clive.shirley/accord-core/artifacts/trace-artifact.js";
import { validateArtifact } from "@clive.shirley/accord-core/artifacts/validation.js";
import { findVerifyTraceDiscrepancies } from "@clive.shirley/accord-core/queries/verify-summary.js";
import type { TaskFileV2 } from "@clive.shirley/accord-core/tasks/types.js";
import Ajv from "ajv";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_TASK = join(here, "..", "schemas", "task-file.example.json");
const ID = "TRACE-1";

let originalCwd: string;
let project: string;

function exampleTask(): TaskFileV2 {
  return JSON.parse(readFileSync(EXAMPLE_TASK, "utf8")) as TaskFileV2;
}

function writeWorkItem(overrides: Record<string, unknown> = {}): void {
  writeFileSync(
    join(".tasks", `${ID}.json`),
    `${JSON.stringify({
      schema_version: "1.0",
      id: ID,
      title: "Trace fixture",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      phase: "implementing",
      task_ids: [1],
      spec: `docs/dev/${ID}/spec.json`,
      plan: `docs/dev/${ID}/plan.json`,
      verify: null,
      brief: `docs/dev/${ID}/brief.md`,
      decisions: [
        {
          id: "esc-1",
          source: "escalation",
          status: "resolved",
          question: "Keep the legacy flag?",
          answer: "No",
          asked_at: "2026-01-01T00:00:00.000Z",
        },
      ],
      deviations: [
        {
          task_id: 1,
          description: "Renamed helper",
          reason: "clash",
          at: "2026-01-01T00:00:00.000Z",
          resolution: "accepted",
        },
      ],
      cost_usd: 0,
      ...overrides,
    })}\n`,
  );
}

function writeTask(task: TaskFileV2): void {
  writeFileSync(join(".tasks", `${ID}-task-${String(task.task)}.json`), JSON.stringify(task));
}

function writeSidecar(name: string, content: string): void {
  const dir = join(".tasks", `${ID}-task-1`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), content);
}

beforeEach(() => {
  originalCwd = process.cwd();
  project = mkdtempSync(join(tmpdir(), "accord-trace-"));
  process.chdir(project);
  mkdirSync(".tasks", { recursive: true });
  writeWorkItem();
  writeTask(exampleTask());
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(project, { recursive: true, force: true });
});

describe("buildWorkItemTrace", () => {
  test("projects task files into per-AC acceptance, risks, rounds, decisions, deviations", () => {
    const built = buildWorkItemTrace(ID);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const trace = built.value;

    expect(trace.tasks).toHaveLength(1);
    const [task] = trace.tasks;
    expect(task?.status).toBe("done");
    expect(task?.rounds).toEqual({ T: 3, C: 4, V: 2 });
    expect(task?.commits).toEqual([]);
    expect(task?.requirements.map((req) => req.id)).toEqual(["AC-1", "AC-2"]);
    expect(task?.requirements[0]?.verification?.test_count).toBe(1);
    expect(task?.requirements[0]?.text).toBeUndefined();

    expect(trace.acceptance.map((entry) => entry.ac_id)).toEqual(["AC-1", "AC-2"]);
    expect(trace.acceptance[0]?.tests).toEqual(["login works"]);
    expect(trace.acceptance[0]?.verified).toBe(true);
    expect(trace.acceptance[0]?.files).toContain("src/auth/session.ts");

    const riskIds = trace.accepted_risks.map((risk) => `${risk.finding_id}:${risk.kind}`);
    expect(riskIds).toEqual(["F-003:unresolved", "F-002:unresolved"]);

    expect(trace.decisions[0]).toMatchObject({ id: "esc-1", answer: "No" });
    expect(trace.deviations[0]).toMatchObject({ task_id: 1, resolution: "accepted" });
  });

  test("keeps the first RED run and last verify run output, truncated", () => {
    writeSidecar("T1-phase-test.output.txt", "FAIL login works\n");
    writeSidecar("T2-phase-test.output.txt", "FAIL later run\n");
    writeSidecar("V1-phase-verify-task.output.txt", "first verify\n");
    writeSidecar("V2-phase-verify-task.output.txt", "x".repeat(TRACE_EXCERPT_MAX_CHARS + 50));

    const built = buildWorkItemTrace(ID);
    if (!built.ok) throw new Error(built.error);
    const [task] = built.value.tasks;
    expect(task?.red_evidence).toEqual({
      ref: "T1/phase-test",
      excerpt: "FAIL login works",
      truncated: false,
    });
    expect(task?.final_verification?.ref).toBe("V2/phase-verify-task");
    expect(task?.final_verification?.truncated).toBe(true);
    expect(task?.final_verification?.excerpt.length).toBe(TRACE_EXCERPT_MAX_CHARS + 1);
  });

  test("records harness commits from the task log", () => {
    const task = exampleTask();
    task.log.push({
      ref: "V2/commit",
      at: "2026-01-01T00:00:00.000Z",
      result: "committed",
      note: "abc1234 [TRACE-1] Task 1: x (2 file(s))",
    });
    writeTask(task);
    const built = buildWorkItemTrace(ID);
    if (!built.ok) throw new Error(built.error);
    expect(built.value.tasks[0]?.commits).toEqual(["abc1234"]);
  });

  test("discovers task files on disk when task_ids is empty", () => {
    writeWorkItem({ task_ids: [] });
    const built = buildWorkItemTrace(ID);
    if (!built.ok) throw new Error(built.error);
    expect(built.value.tasks.map((task) => task.id)).toEqual([1]);
  });
});

describe("writeWorkItemTrace", () => {
  test("writes schema-valid trace.json and a readable trace.md", async () => {
    writeSidecar("T1-phase-test.output.txt", "FAIL login works\n");
    const written = writeWorkItemTrace(ID);
    if (!written.ok) throw new Error(written.error);

    expect(existsSync(written.value.json_path)).toBe(true);
    const validation = await validateArtifact(written.value.json_path);
    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);

    const markdown = readFileSync(written.value.markdown_path, "utf8");
    expect(markdown).toContain(`# Implementation trace: ${ID}`);
    expect(markdown).toContain("### AC-1 — satisfied");
    expect(markdown).toContain("## Accepted risks and unresolved findings");
    expect(markdown).toContain("RED evidence (`T1/phase-test`)");
  });
});

describe("findVerifyTraceDiscrepancies", () => {
  test("flags verify/trace mismatches, missing commits, and critical advisories", () => {
    const built = buildWorkItemTrace(ID);
    if (!built.ok) throw new Error(built.error);
    const discrepancies = findVerifyTraceDiscrepancies(
      [
        { ac_id: "AC-1", status: "pass" },
        { ac_id: "AC-9", status: "pass" },
      ],
      built.value,
    );
    expect(discrepancies).toContain(
      "AC-9: verify says pass, but no task requirement covers it in the trace.",
    );
    expect(discrepancies).toContain("AC-2: covered by the trace but missing from verify.json.");
    expect(discrepancies).toContain("Task 1 is done but has no harness commit recorded.");
    expect(discrepancies.some((item) => item.includes("F-003") && item.includes("critical"))).toBe(
      true,
    );
  });

  test("returns nothing without a trace", () => {
    expect(findVerifyTraceDiscrepancies([{ ac_id: "AC-1", status: "pass" }], null)).toEqual([]);
  });
});

describe("schema examples", () => {
  test.each([
    ["trace.json", "trace-schema.json"],
    ["verify.json", "verify-schema.json"],
  ])("examples/%s validates against %s", (exampleFile, schemaFile) => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(
      JSON.parse(readFileSync(join(here, "..", "schemas", schemaFile), "utf8")),
    );
    const examples = JSON.parse(
      readFileSync(join(here, "..", "schemas", "examples", exampleFile), "utf8"),
    ) as unknown[];
    for (const example of examples) {
      expect(validate(example) ? null : validate.errors).toBeNull();
    }
  });
});
