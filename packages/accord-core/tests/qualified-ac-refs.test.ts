import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildWorkItemTrace,
  writeWorkItemTrace,
} from "@clive.shirley/accord-core/artifacts/trace-artifact.js";
import { validateArtifact } from "@clive.shirley/accord-core/artifacts/validation.js";
import {
  findBareAcRefs,
  normalizeAcId,
  qualifyAcRef,
  qualifyTcRef,
} from "@clive.shirley/accord-core/evidence/qualify-ac.js";
import {
  devVerifySummary,
  findVerifyTraceDiscrepancies,
} from "@clive.shirley/accord-core/queries/verify-summary.js";
import type { TaskFileV2 } from "@clive.shirley/accord-core/tasks/types.js";
import Ajv from "ajv";

const here = dirname(fileURLToPath(import.meta.url));
const EXAMPLE_TASK = join(here, "..", "schemas", "task-file.example.json");
const ID = "ASDLC-1";

let originalCwd: string;
let project: string;

function writeAgentsMd(stack?: Record<string, unknown>): void {
  const config = {
    schema_version: "1.0",
    language: "typescript",
    test: { command: "bun test", file_pattern: "**/*.test.ts" },
    verification_commands: ["bun test"],
    ...(stack ? { stack } : {}),
  };
  writeFileSync(
    "AGENTS.md",
    `# Fixture\n\n## Dev Harness\n\n\`\`\`json\n${JSON.stringify(config, null, 2)}\n\`\`\`\n`,
  );
}

function setup(): void {
  mkdirSync(".tasks", { recursive: true });
  mkdirSync(join("docs", "dev", ID), { recursive: true });
  writeFileSync(
    join(".tasks", `${ID}.json`),
    `${JSON.stringify({
      schema_version: "1.0",
      id: ID,
      title: "Qualify fixture",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      phase: "implementing",
      task_ids: [1],
      spec: `docs/dev/${ID}/spec.json`,
      plan: `docs/dev/${ID}/plan.json`,
      verify: null,
      brief: `docs/dev/${ID}/brief.md`,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    })}\n`,
  );
  const task = JSON.parse(readFileSync(EXAMPLE_TASK, "utf8")) as TaskFileV2;
  writeFileSync(join(".tasks", `${ID}-task-${String(task.task)}.json`), JSON.stringify(task));
}

function writeVerify(acIds: string[]): void {
  writeFileSync(
    join("docs", "dev", ID, "verify.json"),
    JSON.stringify({
      schema_version: "1.0",
      work_item_id: ID,
      date: "2026-01-01",
      verdict: "pass",
      criteria: acIds.map((acId) => ({
        ac_id: acId,
        status: "pass",
        evidence: [{ type: "test", ref: "x.test.ts", detail: "ok" }],
      })),
    }),
  );
}

beforeEach(() => {
  originalCwd = process.cwd();
  project = mkdtempSync(join(tmpdir(), "accord-qualify-"));
  process.chdir(project);
  setup();
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(project, { recursive: true, force: true });
});

describe("ASDLC-1/AC-6 qualify helpers (ASDLC-1/TC-6)", () => {
  test("ASDLC-1/AC-6 qualifyAcRef prefixes the work item id", () => {
    expect(qualifyAcRef("ASDLC-1", "AC-3")).toBe("ASDLC-1/AC-3");
    expect(qualifyAcRef("ABC-42", "AC-12")).toBe("ABC-42/AC-12");
  });

  test("ASDLC-1/AC-6 qualifyTcRef prefixes the work item id", () => {
    expect(qualifyTcRef("ASDLC-1", "TC-6")).toBe("ASDLC-1/TC-6");
  });

  test("ASDLC-1/AC-6 qualifyAcRef is idempotent on an already qualified id", () => {
    expect(qualifyAcRef("ASDLC-1", "ASDLC-1/AC-3")).toBe("ASDLC-1/AC-3");
  });

  test("ASDLC-1/AC-6 normalizeAcId strips the qualifier and leaves bare ids alone", () => {
    expect(normalizeAcId("ASDLC-1/AC-3")).toBe("AC-3");
    expect(normalizeAcId("AC-3")).toBe("AC-3");
    expect(normalizeAcId("ABC-42/AC-12")).toBe("AC-12");
    expect(normalizeAcId("QF")).toBe("QF");
  });

  test("ASDLC-1/AC-30 multi-segment work item ids qualify and normalise", () => {
    expect(normalizeAcId("MY-TEAM-123/AC-3")).toBe("AC-3");
    expect(normalizeAcId("MY_TEAM_7/AC-3")).toBe("AC-3");
    expect(qualifyAcRef("MY-TEAM-123", "MY-TEAM-123/AC-3")).toBe("MY-TEAM-123/AC-3");
    expect(qualifyTcRef("ASDLC-1", "ASDLC-1/TC-6")).toBe("ASDLC-1/TC-6");
  });

  test.each([
    ["bare AC", "see AC-3 for details", ["AC-3"]],
    ["bare TC", "covered by TC-7", ["TC-7"]],
    ["several bare", "AC-1 and AC-2 and TC-3", ["AC-1", "AC-2", "TC-3"]],
    ["qualified AC", "see ASDLC-1/AC-3", []],
    ["qualified TC", "see ASDLC-1/TC-7", []],
    ["mixed", "ASDLC-1/AC-1 plus AC-2", ["AC-2"]],
    ["trailer ac= value", "ac=AC-3", []],
    ["trailer with id", "id=ASDLC-1 ac=AC-3 ref=T1", []],
    ["bare ref outside trailer on another line", "ac=AC-3\nSee AC-4", ["AC-4"]],
    ["empty", "", []],
    ["no refs", "plain text with ABC-123", []],
    ["json string values", '{"ac_id":"AC-1","tc":"TC-2"}', ["AC-1", "TC-2"]],
    ["punctuation and backticks", "(AC-3), AC-4. `TC-5`: done", ["AC-3", "AC-4", "TC-5"]],
    ["full trailer with multi-item ac=", "Accord: v=1 id=ASDLC-1 task=1 ac=AC-1,AC-2 t_pass=3", []],
    ["requirement= is not a trailer", "requirement=AC-3", ["AC-3"]],
    ["AC-/TC- as suffix of a word", "IMAC-7 and ETC-4", []],
    ["qualifier with dashes/underscores", "MY-TEAM-7/AC-3 and MY_TEAM_7/TC-2", []],
    ["qualified json value", '{"ac_id":"ASDLC-1/AC-1"}', []],
  ] as Array<[string, string, string[]]>)(
    "ASDLC-1/AC-6 findBareAcRefs: %s",
    (_name, text, expected) => {
      expect(findBareAcRefs(text)).toEqual(expected);
    },
  );
});

describe("ASDLC-1/AC-6 trace.json with stack.enabled (ASDLC-1/TC-6)", () => {
  test("ASDLC-1/AC-6 acceptance[].ac_id and requirement ids are all qualified, no bare ref", () => {
    writeAgentsMd({ enabled: true });
    const built = buildWorkItemTrace(ID);
    if (!built.ok) throw new Error(built.error);
    const trace = built.value;

    expect(trace.acceptance.map((entry) => entry.ac_id)).toEqual(["ASDLC-1/AC-1", "ASDLC-1/AC-2"]);
    const refSurface = JSON.stringify({
      acceptance: trace.acceptance,
      requirements: trace.tasks.map((task) => task.requirements.map((req) => req.id)),
    });
    expect(findBareAcRefs(refSurface)).toEqual([]);
    expect(refSurface).toContain("ASDLC-1/AC-1");
    expect(trace.tasks[0]?.requirements.map((req) => req.id)).toEqual([
      "ASDLC-1/AC-1",
      "ASDLC-1/AC-2",
    ]);
    expect(trace.accepted_risks.map((risk) => risk.requirement)).toEqual([
      "ASDLC-1/AC-1",
      "ASDLC-1/AC-2",
    ]);
    // Free-text risk issue prose (agent-authored, e.g. "TC-2 fixture shares state") is
    // deliberately not rewritten, so no whole-trace findBareAcRefs assertion (F-002 third item).
  });

  test("ASDLC-1/AC-6 qualified acceptance sorts numerically and omits requirement text", () => {
    writeAgentsMd({ enabled: true });
    const taskPath = join(".tasks", `${ID}-task-1.json`);
    const task = JSON.parse(readFileSync(taskPath, "utf8")) as TaskFileV2;
    task.requirements[0].id = "AC-10";
    writeFileSync(taskPath, JSON.stringify(task));
    const built = buildWorkItemTrace(ID);
    if (!built.ok) throw new Error(built.error);
    expect(built.value.acceptance.map((entry) => entry.ac_id)).toEqual([
      "ASDLC-1/AC-2",
      "ASDLC-1/AC-10",
    ]);
    expect(built.value.tasks[0]?.requirements.every((req) => req.text === undefined)).toBe(true);
  });

  test("ASDLC-1/AC-6 written trace.json is qualified and schema-valid", async () => {
    writeAgentsMd({ enabled: true });
    const written = writeWorkItemTrace(ID);
    if (!written.ok) throw new Error(written.error);
    const onDisk = JSON.parse(readFileSync(written.value.json_path, "utf8")) as {
      acceptance: Array<{ ac_id: string }>;
    };
    expect(onDisk.acceptance.map((entry) => entry.ac_id)).toEqual(["ASDLC-1/AC-1", "ASDLC-1/AC-2"]);
    const validation = await validateArtifact(written.value.json_path);
    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);
  });

  test.each([
    ["no stack block", undefined],
    ["stack.enabled false", { enabled: false }],
    ["stack without enabled", { commits: "phase" }],
  ] as Array<[string, Record<string, unknown> | undefined]>)(
    "ASDLC-1/AC-26 %s leaves trace ac_id bare",
    (_name, stack) => {
      writeAgentsMd(stack);
      const built = buildWorkItemTrace(ID, "2026-01-01T00:00:00.000Z");
      if (!built.ok) throw new Error(built.error);
      expect(built.value.acceptance.map((entry) => entry.ac_id)).toEqual(["AC-1", "AC-2"]);
      expect(JSON.stringify(built.value)).not.toContain("ASDLC-1/AC-");
      expect(JSON.stringify(built.value)).not.toContain("ASDLC-1/TC-");
      expect(built.value.accepted_risks.map((risk) => risk.requirement)).toEqual(["AC-1", "AC-2"]);
      expect(built.value.accepted_risks[1]?.issue).toBe("TC-2 fixture shares state");
    },
  );

  test("ASDLC-1/AC-26 stack unset output is byte-identical to a missing-config run and bare", () => {
    const first = buildWorkItemTrace(ID, "2026-01-01T00:00:00.000Z");
    writeAgentsMd({ enabled: false });
    const second = buildWorkItemTrace(ID, "2026-01-01T00:00:00.000Z");
    if (!first.ok || !second.ok) throw new Error("trace build failed");
    expect(JSON.stringify(second.value)).toBe(JSON.stringify(first.value));
    expect(first.value.acceptance.map((entry) => entry.ac_id)).toEqual(["AC-1", "AC-2"]);
  });

  test("ASDLC-1/AC-26 a legacy bare trace.json still validates", async () => {
    const written = writeWorkItemTrace(ID);
    if (!written.ok) throw new Error(written.error);
    const onDisk = JSON.parse(readFileSync(written.value.json_path, "utf8")) as {
      acceptance: Array<{ ac_id: string }>;
    };
    expect(onDisk.acceptance.map((entry) => entry.ac_id)).toEqual(["AC-1", "AC-2"]);
    const validation = await validateArtifact(written.value.json_path);
    expect(validation.errors).toEqual([]);
    expect(validation.valid).toBe(true);
  });
});

describe("ASDLC-1/AC-26 verify-summary normalises bare and qualified ids", () => {
  function qualifiedTrace() {
    writeAgentsMd({ enabled: true });
    const built = buildWorkItemTrace(ID);
    if (!built.ok) throw new Error(built.error);
    expect(built.value.acceptance.map((entry) => entry.ac_id)).toEqual([
      "ASDLC-1/AC-1",
      "ASDLC-1/AC-2",
    ]);
    return built.value;
  }

  function expectTraceOnDiskQualified(): void {
    const written = writeWorkItemTrace(ID);
    if (!written.ok) throw new Error(written.error);
    expect(readFileSync(join("docs", "dev", ID, "trace.json"), "utf8")).toContain(
      '"ac_id": "ASDLC-1/AC-1"',
    );
  }

  // Hand-qualified trace: independent of how trace-artifact qualifies.
  function handQualifiedTrace() {
    const built = buildWorkItemTrace(ID);
    if (!built.ok) throw new Error(built.error);
    return {
      ...built.value,
      acceptance: built.value.acceptance.map((entry) => ({
        ...entry,
        ac_id: `${ID}/${entry.ac_id}`,
      })),
    };
  }

  test("hand-qualified trace + bare verify.json: no coverage warnings, reverse check fires", () => {
    const none = findVerifyTraceDiscrepancies(
      [
        { ac_id: "AC-1", status: "pass" },
        { ac_id: "AC-2", status: "pass" },
      ],
      handQualifiedTrace(),
    );
    expect(none.filter((item) => item.includes("no task requirement covers it"))).toEqual([]);
    expect(none.filter((item) => item.includes("missing from verify.json"))).toEqual([]);

    const missing = findVerifyTraceDiscrepancies(
      [{ ac_id: "AC-1", status: "pass" }],
      handQualifiedTrace(),
    );
    expect(missing.filter((item) => item.includes("missing from verify.json")).length).toBe(1);
    expect(missing.some((item) => item.includes("AC-2") && item.includes("missing"))).toBe(true);
  });

  test("hand-qualified trace + qualified verify.json: no coverage warnings", () => {
    const none = findVerifyTraceDiscrepancies(
      [
        { ac_id: "ASDLC-1/AC-1", status: "pass" },
        { ac_id: "ASDLC-1/AC-2", status: "pass" },
      ],
      handQualifiedTrace(),
    );
    expect(none.filter((item) => item.includes("no task requirement covers it"))).toEqual([]);
    expect(none.filter((item) => item.includes("missing from verify.json"))).toEqual([]);
  });

  test("hand-qualified trace + uncovered AC-9 still warns", () => {
    const out = findVerifyTraceDiscrepancies(
      [
        { ac_id: "AC-1", status: "pass" },
        { ac_id: "AC-2", status: "pass" },
        { ac_id: "AC-9", status: "pass" },
      ],
      handQualifiedTrace(),
    );
    expect(out.filter((item) => item.includes("no task requirement covers it")).length).toBe(1);
  });

  test("qualified trace + bare verify.json yields no 'no task requirement covers it' warning", () => {
    const discrepancies = findVerifyTraceDiscrepancies(
      [
        { ac_id: "AC-1", status: "pass" },
        { ac_id: "AC-2", status: "pass" },
      ],
      qualifiedTrace(),
    );
    expect(discrepancies.filter((item) => item.includes("no task requirement covers it"))).toEqual(
      [],
    );
    expect(discrepancies.filter((item) => item.includes("missing from verify.json"))).toEqual([]);
  });

  test("qualified trace + qualified verify.json yields no coverage warnings", () => {
    const discrepancies = findVerifyTraceDiscrepancies(
      [
        { ac_id: "ASDLC-1/AC-1", status: "pass" },
        { ac_id: "ASDLC-1/AC-2", status: "pass" },
      ],
      qualifiedTrace(),
    );
    expect(discrepancies.filter((item) => item.includes("no task requirement covers it"))).toEqual(
      [],
    );
    expect(discrepancies.filter((item) => item.includes("missing from verify.json"))).toEqual([]);
  });

  test("reverse check still fires for a trace requirement missing from verify.json", () => {
    const discrepancies = findVerifyTraceDiscrepancies(
      [{ ac_id: "AC-1", status: "pass" }],
      qualifiedTrace(),
    );
    expect(
      discrepancies.some(
        (item) => item.includes("AC-2") && item.includes("missing from verify.json"),
      ),
    ).toBe(true);
    expect(
      discrepancies.some(
        (item) => item.includes("AC-1") && item.includes("missing from verify.json"),
      ),
    ).toBe(false);
  });

  test("status-mismatch warning fires across qualified trace and bare verify ids", () => {
    const trace = handQualifiedTrace();
    trace.acceptance[0].status = "implemented";
    const out = findVerifyTraceDiscrepancies(
      [
        { ac_id: "AC-1", status: "pass" },
        { ac_id: "AC-2", status: "pass" },
      ],
      trace,
    );
    expect(
      out.some((item) => item.includes("AC-1") && item.includes("trace status is `implemented`")),
    ).toBe(true);
  });

  test("bare trace + qualified verify.json yields no coverage warnings", () => {
    const built = buildWorkItemTrace(ID);
    if (!built.ok) throw new Error(built.error);
    expect(built.value.acceptance.map((entry) => entry.ac_id)).toEqual(["AC-1", "AC-2"]);
    const out = findVerifyTraceDiscrepancies(
      [
        { ac_id: "ASDLC-1/AC-1", status: "pass" },
        { ac_id: "ASDLC-1/AC-2", status: "pass" },
      ],
      built.value,
    );
    expect(out.filter((item) => item.includes("no task requirement covers it"))).toEqual([]);
    expect(out.filter((item) => item.includes("missing from verify.json"))).toEqual([]);
  });

  test("a verify pass for an AC the qualified trace does not cover still warns", () => {
    const discrepancies = findVerifyTraceDiscrepancies(
      [
        { ac_id: "AC-1", status: "pass" },
        { ac_id: "AC-9", status: "pass" },
      ],
      qualifiedTrace(),
    );
    expect(
      discrepancies.some(
        (item) => item.includes("AC-9") && item.includes("no task requirement covers it"),
      ),
    ).toBe(true);
  });

  test("verify.md AC trace section renders a qualified trace against a bare verify.json", () => {
    writeAgentsMd({ enabled: true });
    expectTraceOnDiskQualified();
    writeVerify(["AC-1", "AC-2"]);
    const summary = devVerifySummary(ID);
    if (!summary.ok) throw new Error(summary.error);
    const markdown = readFileSync(join("docs", "dev", ID, "verify.md"), "utf8");
    expect(markdown).not.toContain("no task requirement covers this AC");
    expect(markdown).toContain("Implementation: task 1 (satisfied)");
  });

  test("verify.md AC trace section still reports a genuinely uncovered AC", () => {
    writeAgentsMd({ enabled: true });
    expectTraceOnDiskQualified();
    writeVerify(["AC-1", "AC-2", "AC-9"]);
    const summary = devVerifySummary(ID);
    if (!summary.ok) throw new Error(summary.error);
    const markdown = readFileSync(join("docs", "dev", ID, "verify.md"), "utf8");
    expect(markdown).toContain("no task requirement covers this AC");
  });
});

describe("ASDLC-1/AC-30 trace-schema ac_id pattern", () => {
  const schemaDir = join(here, "..", "schemas");
  function validateWithAcId(acId: string): boolean {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(
      JSON.parse(readFileSync(join(schemaDir, "trace-schema.json"), "utf8")),
    );
    const [example] = JSON.parse(
      readFileSync(join(schemaDir, "examples", "trace.json"), "utf8"),
    ) as Array<{ acceptance: Array<{ ac_id: string }> }>;
    if (!example) throw new Error("no example");
    const copy = structuredClone(example);
    copy.acceptance[0].ac_id = acId;
    return validate(copy) === true;
  }

  test.each(["AC-1", "QF", "ASDLC-1/AC-1", "MY-TEAM-123/AC-12"])(
    "ASDLC-1/AC-30 accepts ac_id %s",
    (acId) => {
      expect(validateWithAcId(acId)).toBe(true);
    },
  );

  test.each(["AC-x", "ac-1", "/AC-1", "ASDLC-1/", "ASDLC-1/AC-", "note AC-1", "ASDLC-1/TC-1"])(
    "ASDLC-1/AC-30 rejects ac_id %s",
    (acId) => {
      expect(validateWithAcId(acId)).toBe(false);
    },
  );
});
