import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import {
  INPUTS,
  OPTIONAL_SECRETS,
  REQUIRED_SECRETS,
  type WorkflowInputSpec,
} from "../../scripts/ci/lib/inputs.js";

const WORKFLOW_PATH = join(import.meta.dir, "../../.github/workflows/autopipeline.yml");
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
