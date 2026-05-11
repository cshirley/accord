// Regression tests for the maintainer-only smoke wrapper
// (.github/workflows/autopipeline-smoke.yml).
//
// History: the smoke wrapper exposes `dry_run` (boolean) and `max_cost_usd`
// (number) via `workflow_dispatch.inputs` and forwards them to the reusable
// `autopipeline.yml` via `workflow_call`. GitHub serializes
// `workflow_dispatch` inputs as strings ("true", "1") before they reach the
// caller; the reusable workflow's typed `workflow_call.inputs` then rejects
// those string values with:
//
//   load reusable workflow context: evaluate reusable workflow inputs:
//   .github/workflows/autopipeline-smoke.yml (Line: N, Col: M):
//   Unexpected value '1'
//
// Mitigation: every non-string forwarded input MUST be wrapped in
// `fromJSON(...)` so the reusable workflow receives a true boolean / number.
// These tests pin that invariant so the regression cannot recur silently.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

const SMOKE_PATH = join(import.meta.dir, "../../.github/workflows/autopipeline-smoke.yml");
const AUTOPIPELINE_PATH = join(import.meta.dir, "../../.github/workflows/autopipeline.yml");

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`expected object at ${label}, got ${typeof value}`);
  }
  return value as Record<string, unknown>;
}

const smoke = parseYaml(readFileSync(SMOKE_PATH, "utf8")) as Record<string, unknown>;
const autopipeline = parseYaml(readFileSync(AUTOPIPELINE_PATH, "utf8")) as Record<string, unknown>;

const smokeOn = asRecord(smoke.on, "smoke.on");
const smokeDispatch = asRecord(smokeOn.workflow_dispatch, "smoke.on.workflow_dispatch");
const smokeInputs = asRecord(smokeDispatch.inputs, "smoke.on.workflow_dispatch.inputs");

const smokeJobs = asRecord(smoke.jobs, "smoke.jobs");
const smokeJob = asRecord(smokeJobs.smoke, "smoke.jobs.smoke");
const smokeWith = asRecord(smokeJob.with, "smoke.jobs.smoke.with");

const autopipelineOn = asRecord(autopipeline.on, "autopipeline.on");
const autopipelineCall = asRecord(autopipelineOn.workflow_call, "autopipeline.on.workflow_call");
const autopipelineCallInputs = asRecord(
  autopipelineCall.inputs,
  "autopipeline.on.workflow_call.inputs",
);

describe("autopipeline-smoke wrapper", () => {
  test("forwards every reusable-workflow input it owns", () => {
    for (const key of Object.keys(smokeWith)) {
      expect(autopipelineCallInputs).toHaveProperty(key);
    }
  });

  test("non-string inputs are forwarded via fromJSON to match workflow_call types", () => {
    for (const [key, value] of Object.entries(smokeWith)) {
      if (typeof value !== "string") {
        throw new Error(`smoke.with.${key} must be a templated string, got ${typeof value}`);
      }
      const calledInput = asRecord(
        autopipelineCallInputs[key],
        `autopipeline...inputs.${key}`,
      );
      const calledType = calledInput.type;
      if (calledType === "boolean" || calledType === "number") {
        expect(value).toMatch(/fromJSON\s*\(\s*inputs\./);
      } else if (calledType === "string") {
        expect(value).toMatch(/\$\{\{[^}]+\}\}/);
      } else {
        throw new Error(`unexpected called-input type for ${key}: ${String(calledType)}`);
      }
    }
  });

  test("inherits secrets so the wrapper never enumerates them", () => {
    expect(smokeJob.secrets).toBe("inherit");
  });

  test("dispatches autopipeline.yml from the same repo (not a remote ref)", () => {
    expect(smokeJob.uses).toBe("./.github/workflows/autopipeline.yml");
  });

  test("default for dry_run is true (smoke never touches real side effects by default)", () => {
    const dryRunInput = asRecord(smokeInputs.dry_run, "smoke.inputs.dry_run");
    expect(dryRunInput.type).toBe("boolean");
    expect(dryRunInput.default).toBe(true);
  });

  test("default for max_cost_usd is small (smoke is cheap by default)", () => {
    const costInput = asRecord(smokeInputs.max_cost_usd, "smoke.inputs.max_cost_usd");
    expect(costInput.type).toBe("number");
    const dflt = costInput.default;
    if (typeof dflt !== "number") {
      throw new Error(`max_cost_usd default must be a number, got ${typeof dflt}`);
    }
    expect(dflt).toBeLessThanOrEqual(5);
  });
});
