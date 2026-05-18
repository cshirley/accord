import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import {
  INPUTS,
  OPTIONAL_SECRETS,
  REQUIRED_SECRETS,
  type WorkflowInputSpec,
} from "../src/lib/inputs.js";

const WORKFLOW_PATH = join(import.meta.dir, "../../../.github/workflows/autopipeline.yml");
const workflow = parseYaml(readFileSync(WORKFLOW_PATH, "utf8")) as Record<string, unknown>;

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("expected object");
  }
  return value as Record<string, unknown>;
}

const on = asRecord(workflow.on);
const workflowCall = asRecord(on.workflow_call);
const wcInputs = asRecord(workflowCall.inputs);
const wcSecrets = asRecord(workflowCall.secrets);
const repoDispatch = asRecord(on.repository_dispatch);

const jobs = asRecord(workflow.jobs);
const jobNames = Object.keys(jobs);
const mainJob = asRecord(jobs[jobNames[0]!]);

describe("AC-15: workflow_call inputs surface", () => {
  test("declares exactly the AC-15 input set", () => {
    expect(new Set(Object.keys(wcInputs))).toEqual(new Set(INPUTS.map((i) => i.name)));
  });

  for (const raw of INPUTS) {
    const spec = raw as WorkflowInputSpec;
    test(`input "${spec.name}" has type "${spec.type}" and required=${spec.required}`, () => {
      const declared = asRecord(wcInputs[spec.name]);
      expect(declared.type).toBe(spec.type);
      if (spec.required) {
        expect(declared.required).toBe(true);
      } else {
        expect(declared.required ?? false).toBe(false);
      }
    });

    if (spec.default !== undefined) {
      test(`input "${spec.name}" defaults to ${JSON.stringify(spec.default)}`, () => {
        const declared = asRecord(wcInputs[spec.name]);
        expect(declared.default).toBe(spec.default);
      });
    }
  }
});

describe("AC-15: workflow_call secrets surface", () => {
  test("declares all required secrets as required: true", () => {
    for (const name of REQUIRED_SECRETS) {
      const secret = asRecord(wcSecrets[name]);
      expect(secret.required).toBe(true);
    }
  });

  test("declares optional secrets without required: true", () => {
    for (const name of OPTIONAL_SECRETS) {
      const secret = asRecord(wcSecrets[name]);
      expect(secret.required ?? false).toBe(false);
    }
  });

  test("declares exactly the union of required and optional secret names", () => {
    expect(new Set(Object.keys(wcSecrets))).toEqual(
      new Set([...REQUIRED_SECRETS, ...OPTIONAL_SECRETS]),
    );
  });
});

describe("AC-1: dual triggers (workflow_call + repository_dispatch)", () => {
  test("declares on.repository_dispatch.types as [accord-autopipeline]", () => {
    expect(repoDispatch.types).toEqual(["accord-autopipeline"]);
  });

  test("declares on.workflow_call (the reusable trigger)", () => {
    expect(workflowCall).toBeDefined();
  });
});

describe("AC-19: concurrency block on the main job", () => {
  test("main job declares concurrency.group = accord-${{ inputs.ticket }}", () => {
    const concurrency = asRecord(mainJob.concurrency);
    expect(concurrency.group).toBe("accord-${{ inputs.ticket }}");
  });

  test("main job declares concurrency.cancel-in-progress = false", () => {
    const concurrency = asRecord(mainJob.concurrency);
    expect(concurrency["cancel-in-progress"]).toBe(false);
  });

  test("no conflicting workflow-level concurrency block is present", () => {
    expect(workflow.concurrency).toBeUndefined();
  });
});

describe("AC-1: dispatch event-name canonicalisation (real-runner contract)", () => {
  // History: inside a reusable workflow, `github.event_name` always reflects
  // the OUTER event that initiated the run (`workflow_dispatch`, `push`,
  // etc.) — never `workflow_call`, even though the inner workflow was
  // invoked via `workflow_call`. The dispatch validator's strict allow-list
  // (`workflow_call` | `repository_dispatch`) would therefore reject every
  // legitimate same-repo invocation if we forwarded `github.event_name`
  // verbatim. The workflow YAML canonicalises the event name BEFORE handing
  // it to the validator: anything that is not `repository_dispatch` is
  // treated as `workflow_call`. This is the contract the validator relies
  // on and must not silently drift.
  function dispatchStep(): Record<string, unknown> {
    const steps = mainJob.steps as Array<Record<string, unknown>>;
    const step = steps.find((s) => s.id === "dispatch");
    if (!step) throw new Error("dispatch step (id=dispatch) not found in main job");
    return step;
  }

  test("dispatch step sets ACCORD_DISPATCH_KIND via canonicalisation expression", () => {
    const step = dispatchStep();
    const env = asRecord(step.env);
    const expr = env.ACCORD_DISPATCH_KIND;
    if (typeof expr !== "string") {
      throw new Error(`ACCORD_DISPATCH_KIND must be a templated expression, got ${typeof expr}`);
    }
    // Must short-circuit on repository_dispatch and fall through to workflow_call.
    expect(expr).toMatch(/github\.event_name\s*==\s*'repository_dispatch'/);
    expect(expr).toMatch(/'repository_dispatch'/);
    expect(expr).toMatch(/'workflow_call'/);
    // Must NOT condition on `env.ACT` (prior incorrect narrowing).
    expect(expr).not.toMatch(/env\.ACT/);
  });

  test("dispatch step does NOT try to override GITHUB_EVENT_NAME (reserved by runner)", () => {
    const step = dispatchStep();
    const env = asRecord(step.env);
    // GITHUB_EVENT_NAME is runner-reserved and overrides via step env are
    // silently ignored on real GitHub. If we set it here it's a footgun:
    // the value would silently take effect under `act` (which honours
    // step env for GITHUB_*) and silently NOT take effect on real CI.
    // ACCORD_DISPATCH_KIND is the canonical signal instead.
    expect(env.GITHUB_EVENT_NAME).toBeUndefined();
  });

  test("dispatch step still forwards github.event_path unchanged", () => {
    const step = dispatchStep();
    const env = asRecord(step.env);
    expect(env.GITHUB_EVENT_PATH).toBe("${{ github.event_path }}");
  });

  test("dispatch step runs pi-accord-ci dispatch.ts (no inlined validator)", () => {
    const step = dispatchStep();
    expect(step.run).toBe(
      "bun run .accord-ci/packages/pi-accord-ci/src/dispatch.ts",
    );
  });
});

describe("AC-15: minimum permissions block", () => {
  test("workflow declares permissions.contents = write", () => {
    const perms = asRecord(workflow.permissions);
    expect(perms.contents).toBe("write");
  });

  test("workflow declares permissions.pull-requests = write", () => {
    const perms = asRecord(workflow.permissions);
    expect(perms["pull-requests"]).toBe("write");
  });

  test("workflow declares permissions.issues = write", () => {
    const perms = asRecord(workflow.permissions);
    expect(perms.issues).toBe("write");
  });

  test("workflow does NOT request additional scopes beyond contents/pull-requests/issues", () => {
    const perms = asRecord(workflow.permissions);
    const allowedKeys = new Set(["contents", "pull-requests", "issues"]);
    for (const key of Object.keys(perms)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
  });
});
