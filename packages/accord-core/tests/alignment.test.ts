import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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
