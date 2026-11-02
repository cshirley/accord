import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildInterviewResumeTaskIfApplicable } from "@clive.shirley/accord-core/orchestration/resolve/interview-task.js";
import Ajv from "ajv";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCHEMA_PATH = "packages/accord-core/schemas/accord-schema.json";
const schema = JSON.parse(readFileSync(join(ROOT, SCHEMA_PATH), "utf8"));

function run(script: string): { code: number | null; out: string } {
  const proc = Bun.spawnSync(["bun", "run", script], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  return { code: proc.exitCode, out: `${proc.stdout.toString()}${proc.stderr.toString()}` };
}

const securitySchema = () =>
  schema.properties.orchestration.properties.review_loop.properties.review_security;

describe("ASDLC-1/AC-30 schema alignment (ASDLC-1/TC-31)", () => {
  it("ASDLC-1/AC-30 validate:schemas exits 0", () => {
    const { code, out } = run("validate:schemas");
    expect({ code, out: code === 0 ? "" : out }).toEqual({ code: 0, out: "" });
  }, 120_000);

  it("ASDLC-1/AC-30 validate:assets exits 0", () => {
    const { code, out } = run("validate:assets");
    expect({ code, out: code === 0 ? "" : out }).toEqual({ code: 0, out: "" });
  }, 120_000);

  it("ASDLC-1/AC-30 review_security description says the harness reads it (no PROPOSED marker)", () => {
    const description: string = securitySchema().description;
    expect(description).not.toMatch(/PROPOSED/i);
    expect(description).not.toMatch(/\bnot\s+(yet\s+)?read by the harness/i);
    expect(description).toMatch(/read by the harness/i);
    expect(description).toContain("okf/references/stack-config.md");
  });

  it("ASDLC-1/AC-30 review_security keeps advisory as the documented schema default", () => {
    const description: string = securitySchema().description;
    expect(description).toMatch(/Schema default:\s*advisory/);
    expect(description).toMatch(/stack\.enabled/);
    expect(description).toMatch(/stack\.enabled true the effective default is warn/);
    // default stays unset in the schema, so behaviour is unchanged
    expect(securitySchema().properties.severity_gate.default).toBeUndefined();
  });

  it("ASDLC-1/AC-30 severity_gate enum is exactly advisory, none, warn, block", () => {
    const gate = securitySchema().properties.severity_gate;
    expect([...gate.enum].sort()).toEqual(["advisory", "block", "none", "warn"]);
    expect(securitySchema().additionalProperties).toBe(false);
  });

  it("ASDLC-1/AC-30 a misaligned review_security config is rejected by the schema", () => {
    const ajv = new Ajv({ strict: false, allErrors: true });
    const validate = ajv.compile(schema);
    const base = (review_security: unknown) => ({
      schema_version: "1.0",
      language: "typescript",
      test: { command: "bun test", file_pattern: "**/*.test.ts" },
      verification_commands: ["bun test"],
      orchestration: { review_loop: { review_security } },
    });
    for (const bad of [
      { severity_gate: "major" },
      { severity_gate: "WARN" },
      { severity_gate: "" },
      { extra: 1 },
    ]) {
      expect(validate(base(bad))).toBe(false);
    }
    for (const gate of ["advisory", "none", "warn", "block"]) {
      const ok = validate(base({ severity_gate: gate }));
      expect({ gate, ok, errors: ok ? [] : validate.errors }).toEqual({
        gate,
        ok: true,
        errors: [],
      });
    }
  });
});

const planSchema = JSON.parse(
  readFileSync(join(ROOT, "packages/accord-core/schemas/plan-schema.json"), "utf8"),
);

function planWith(taskExtra: Record<string, unknown>) {
  return {
    schema_version: "1.0",
    work_item_id: "ASDLC-1",
    spec: "docs/dev/ASDLC-1/spec.json",
    tasks: [
      {
        id: 1,
        title: "t",
        covers_ac: ["AC-1"],
        challenge: false,
        depends_on: [],
        files: [{ path: "a.ts", action: "add" }],
        steps: [{ tag: "test", description: "d" }],
        ...taskExtra,
      },
    ],
  };
}

describe("ASDLC-1/AC-30 plan schema stack fields (ASDLC-1/TC-31)", () => {
  const validate = () => new Ajv({ strict: false, allErrors: true }).compile(planSchema);

  it("ASDLC-1/AC-30 baseline plan without stack fields still validates", () => {
    const v = validate();
    expect({ ok: v(planWith({})), errors: v.errors }).toEqual({ ok: true, errors: null });
  });

  it("ASDLC-1/AC-30 est_lines, concern, flag and kind validate together with depends_on", () => {
    const v = validate();
    const ok = v(
      planWith({
        est_lines: 120,
        concern: "stack-compute",
        flag: "stack.enabled",
        kind: "feature",
        depends_on: [2],
      }),
    );
    expect({ ok, errors: v.errors }).toEqual({ ok: true, errors: null });
  });

  it.each(["feature", "refactor", "schema", "interface", "enable"])(
    "ASDLC-1/AC-30 kind %s is accepted",
    (kind) => {
      expect(validate()(planWith({ kind }))).toBe(true);
    },
  );

  it.each(["bogus", "Feature", "FEATURE", "", "features", " feature", "test"])(
    "ASDLC-1/AC-30 unknown kind %j fails",
    (kind) => {
      expect(validate()(planWith({ kind }))).toBe(false);
    },
  );

  it("ASDLC-1/AC-30 kind must be a string, not a number or null", () => {
    expect(validate()(planWith({ kind: 1 }))).toBe(false);
    expect(validate()(planWith({ kind: null }))).toBe(false);
  });

  it.each([0, 1, 400, 100000])("ASDLC-1/AC-30 est_lines %p accepted", (est_lines) => {
    expect(validate()(planWith({ est_lines }))).toBe(true);
  });

  it.each([-1, 1.5, "10", null, true])("ASDLC-1/AC-30 est_lines %p rejected", (est_lines) => {
    expect(validate()(planWith({ est_lines }))).toBe(false);
  });

  it.each([5, null, [["a"]], {}])("ASDLC-1/AC-30 concern %p rejected (string only)", (concern) => {
    expect(validate()(planWith({ concern }))).toBe(false);
  });

  it.each([5, null, true, [["a"]]])("ASDLC-1/AC-30 flag %p rejected (string only)", (flag) => {
    expect(validate()(planWith({ flag }))).toBe(false);
  });

  it("ASDLC-1/AC-30 the new fields are optional and other unknown task keys stay rejected", () => {
    expect(validate()(planWith({ unknown_field: 1 }))).toBe(false);
    expect(planSchema.properties.tasks.items.required).toEqual([
      "id",
      "title",
      "covers_ac",
      "challenge",
      "files",
      "steps",
    ]);
    const props = planSchema.properties.tasks.items.properties;
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining(["est_lines", "concern", "flag", "kind", "depends_on"]),
    );
  });

  it("ASDLC-1/AC-30 the plan example fixtures remain valid via validate:schemas", () => {
    const { code } = run("validate:schemas");
    expect(code).toBe(0);
  }, 120_000);
});

describe("ASDLC-1/AC-30 manifest vs registry misalignment fails validate:assets (ASDLC-1/TC-31)", () => {
  let tmp: string;
  beforeEach(() => {
    mkdirSync(join(ROOT, "packages"), { recursive: true });
    tmp = mkdtempSync(join(ROOT, "packages", ".align-"));
    cpSync(join(ROOT, "packages/accord-assets"), join(tmp, "accord-assets"), { recursive: true });
    symlinkSync(join(ROOT, "packages/accord-core"), join(tmp, "accord-core"));
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  const runCopy = () => {
    const proc = Bun.spawnSync(["bun", join(tmp, "accord-assets/scripts/validate-assets.ts")], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    return { code: proc.exitCode, out: `${proc.stdout.toString()}${proc.stderr.toString()}` };
  };

  it("ASDLC-1/AC-30 unmodified copy of manifest passes (control)", () => {
    const { code, out } = runCopy();
    expect({ code, out: code === 0 ? "" : out }).toEqual({ code: 0, out: "" });
  }, 120_000);

  it("ASDLC-1/AC-30 manifest agent absent from registry.ts makes validate:assets fail", () => {
    const manifestPath = join(tmp, "accord-assets/manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.assets.agents.push("phase-not-in-registry");
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    const { code, out } = runCopy();
    expect(code).not.toBe(0);
    expect(out).toContain("manifest agents vs registry mismatch");
    expect(out).toContain("phase-not-in-registry");
  }, 120_000);
});

describe("ASDLC-1/AC-30 phase-plan agent and docs carry the stack planning contract", () => {
  const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

  it("ASDLC-1/AC-30 phase-plan.md has the gated Stack planning section", () => {
    const md = read("packages/accord-assets/agents/accord/phase-plan.md");
    expect(md).toContain("Stack planning (only when the task text says stack_enabled: true)");
    for (const word of ["vertical slice", "concern", "est_lines", "challenge"]) {
      expect(md.toLowerCase()).toContain(word);
    }
  });

  it("ASDLC-1/AC-31 okf/references/schemas.md documents the plan stack fields", () => {
    const md = read("okf/references/schemas.md");
    for (const field of ["est_lines", "concern", "flag", "kind"]) {
      expect(md).toContain(field);
    }
    for (const kind of ["feature", "refactor", "schema", "interface", "enable"]) {
      expect(md).toContain(kind);
    }
  });
});

describe("ASDLC-1/AC-26 phase-plan task text gated by stack.enabled", () => {
  let tempCwd: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    tempCwd = mkdtempSync(join(tmpdir(), "accord-stack-plan-"));
    process.chdir(tempCwd);
    mkdirSync(join(tempCwd, ".tasks"), { recursive: true });
  });
  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(tempCwd, { recursive: true, force: true });
  });

  function writeConfig(stack: Record<string, unknown> | undefined) {
    const cfg = {
      schema_version: "1.0",
      language: "typescript",
      test: { command: "bun test", file_pattern: "**/*.test.ts" },
      verification_commands: ["bun test"],
      ...(stack ? { stack } : {}),
    };
    writeFileSync(
      join(tempCwd, "AGENTS.md"),
      `# x\n\n## Dev Harness\n\n\`\`\`json\n${JSON.stringify(cfg, null, 2)}\n\`\`\`\n`,
      "utf8",
    );
  }

  function planTask(): string {
    const wi = {
      schema_version: "1.0",
      id: "PLAN-1",
      title: "t",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      variant: "standard",
      phase: "planning",
      brief: "docs/dev/PLAN-1/brief.md",
      spec: "docs/dev/PLAN-1/spec.json",
      plan: null,
      verify: null,
      task_ids: [],
      decisions: [],
      deviations: [],
      cost_usd: 0,
    };
    writeFileSync(join(".tasks", "PLAN-1.json"), `${JSON.stringify(wi, null, 2)}\n`, "utf8");
    const task = buildInterviewResumeTaskIfApplicable({
      workItemId: "PLAN-1",
      phase: "planning",
      title: "t",
      pattern: "implement",
      variant: "standard",
      dispatchAgent: "phase-plan",
    });
    expect(task).not.toBeNull();
    return task as string;
  }

  const unchanged = (t: string) => {
    expect(t).not.toContain("stack_enabled");
    expect(t).not.toMatch(/stack planning/i);
  };

  it("ASDLC-1/AC-26 no stack config: no stack section, no marker", () => {
    writeConfig(undefined);
    unchanged(planTask());
  });

  it("ASDLC-1/AC-26 stack.enabled unset (other stack keys present): no section, no marker", () => {
    writeConfig({ commits: "phase", sizing: { max_pr_lines: 321 } });
    const t = planTask();
    unchanged(t);
    expect(t).not.toContain("321");
  });

  it("ASDLC-1/AC-26 stack.enabled false: no section, no marker", () => {
    writeConfig({ enabled: false });
    unchanged(planTask());
  });

  it("ASDLC-1/AC-26 stack.enabled true: marker and default sizing budgets present", () => {
    writeConfig({ enabled: true });
    const t = planTask();
    expect(t).toContain("stack_enabled: true");
    expect(t).toMatch(/stack planning/i);
    for (const budget of ["400", "30", "10", "1.5", "6"]) {
      expect(t).toMatch(new RegExp(`(?<![\\d.])${budget.replace(".", "\\.")}(?![\\d.])`));
    }
  });

  it("ASDLC-1/AC-26 stack.enabled true: configured sizing budgets are carried through", () => {
    writeConfig({
      enabled: true,
      sizing: {
        max_pr_lines: 321,
        min_pr_lines: 17,
        max_files: 13,
        max_depth: 9,
        overrun_factor: 2.75,
      },
    });
    const t = planTask();
    expect(t).toContain("stack_enabled: true");
    for (const budget of ["321", "17", "13", "9", "2.75"]) {
      expect(t).toContain(budget);
    }
    expect(t).not.toMatch(/(?<![\d.])400(?![\d.])/);
  });

  it("ASDLC-1/AC-26 enabling stack keeps the base task text lines", () => {
    writeConfig({ enabled: true });
    const t = planTask();
    expect(t).toContain("work_item_id: PLAN-1");
    expect(t).toContain("spec_path: docs/dev/PLAN-1/spec.json");
    expect(t).toContain("Write `docs/dev/<work_item_id>/plan.json` when converged");
  });
});
