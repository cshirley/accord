import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { bootstrapWorkItem } from "../src/bootstrap-work-item.js";
import type { JiraIssue } from "../src/gate-ticket.js";

const PASSING: JiraIssue = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures/jira/gate-passing.json"), "utf8"),
);

let tempCwd: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  tempCwd = mkdtempSync(join(tmpdir(), "accord-bootstrap-"));
  process.chdir(tempCwd);
  // The devBootstrap helper writes to relative `.tasks/`; ensure dir exists.
  mkdirSync(join(tempCwd, ".tasks"), { recursive: true });
  // Seed a brief.md file so we can pass its path.
  mkdirSync(join(tempCwd, "docs/dev", PASSING.key), { recursive: true });
  writeFileSync(join(tempCwd, "docs/dev", PASSING.key, "brief.md"), "# stub brief", "utf8");
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tempCwd, { recursive: true, force: true });
});

describe("bootstrapWorkItem (AC-5)", () => {
  test("writes .tasks/<ticket>.json with the canonical implement/standard shape", async () => {
    const { taskStatePath } = await bootstrapWorkItem({
      ticket: PASSING,
      briefPath: join("docs/dev", PASSING.key, "brief.md"),
    });
    expect(taskStatePath).toBe(join(".tasks", `${PASSING.key}.json`));
    expect(existsSync(taskStatePath)).toBe(true);
    const wi = JSON.parse(readFileSync(taskStatePath, "utf8"));
    expect(wi.id).toBe(PASSING.key);
    expect(wi.pattern).toBe("implement");
    expect(wi.variant).toBe("standard");
    // For implement/standard, ENTRY_PHASES sends us to "aligning"; but the
    // autopipeline seeds the brief and skips align — we'll have transitioned
    // forward to `speccing` by the time bootstrap returns.
    expect(wi.phase).toBe("speccing");
  });

  test("links the brief.md path on the work item", async () => {
    await bootstrapWorkItem({
      ticket: PASSING,
      briefPath: join("docs/dev", PASSING.key, "brief.md"),
    });
    const wi = JSON.parse(readFileSync(join(".tasks", `${PASSING.key}.json`), "utf8"));
    expect(wi.brief).toBe(join("docs/dev", PASSING.key, "brief.md"));
  });

  test("embeds the ticket summary as the work item title", async () => {
    await bootstrapWorkItem({
      ticket: PASSING,
      briefPath: join("docs/dev", PASSING.key, "brief.md"),
    });
    const wi = JSON.parse(readFileSync(join(".tasks", `${PASSING.key}.json`), "utf8"));
    expect(wi.title).toBe(PASSING.fields.summary);
  });

  test("captures the intent contract on the work item", async () => {
    await bootstrapWorkItem({
      ticket: PASSING,
      briefPath: join("docs/dev", PASSING.key, "brief.md"),
    });
    const wi = JSON.parse(readFileSync(join(".tasks", `${PASSING.key}.json`), "utf8"));
    expect(wi.intent_mode).toBe("pipeline");
    expect(wi.escalation_ceiling).toBe("pipeline_allowed");
  });
});

describe("bootstrapWorkItem — idempotency (AC-5 resume safety)", () => {
  test("re-running on an existing work item is a no-op and preserves progress", async () => {
    await bootstrapWorkItem({
      ticket: PASSING,
      briefPath: join("docs/dev", PASSING.key, "brief.md"),
    });
    // Simulate prior phase progress: advance to `coding` and write a fake spec ref.
    const wiPath = join(".tasks", `${PASSING.key}.json`);
    const wi = JSON.parse(readFileSync(wiPath, "utf8"));
    wi.phase = "coding";
    wi.spec = `docs/dev/${PASSING.key}/spec.json`;
    wi.cost_usd = 4.2;
    writeFileSync(wiPath, JSON.stringify(wi, null, 2));

    // Re-bootstrap — should NOT overwrite phase/spec/cost progress.
    await bootstrapWorkItem({
      ticket: PASSING,
      briefPath: join("docs/dev", PASSING.key, "brief.md"),
    });
    const after = JSON.parse(readFileSync(wiPath, "utf8"));
    expect(after.phase).toBe("coding");
    expect(after.spec).toBe(`docs/dev/${PASSING.key}/spec.json`);
    expect(after.cost_usd).toBe(4.2);
  });
});

describe("bootstrapWorkItem — does not spawn subprocesses (AC-6)", () => {
  test("returns synchronously-ish without invoking any `pi` binary", async () => {
    // We assert this by structural means in no-extra-pi-spawns.test.ts. Here
    // we just confirm the API returns a result object (not stuck waiting on
    // a child process).
    const r = await bootstrapWorkItem({
      ticket: PASSING,
      briefPath: join("docs/dev", PASSING.key, "brief.md"),
    });
    expect(typeof r.taskStatePath).toBe("string");
  });
});
