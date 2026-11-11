import { afterEach, beforeEach, describe, expect, it, setDefaultTimeout, spyOn } from "bun:test";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { commitTaskEvidence } from "../../src/commit/evidence-commit.js";
import { tryCommitPhase } from "../../src/commit/phase-commit.js";
import type { DevHarnessConfig } from "../../src/config/types.js";
import { buildEvidenceAsset } from "../../src/evidence/asset.js";
import { getLogLevel, setLogLevel } from "../../src/logging.js";
import { resolveActivePrimaryTaskId } from "../../src/orchestration/post-result/primary-task.js";
import { resolveResumeOrchestration } from "../../src/orchestration/resolve/resume.js";
import { restoreStateFromTree } from "../../src/state/restore.js";
import { allocateRef } from "../../src/tasks/model.js";
import { loadTaskV2, mutateTaskV2 } from "../../src/tasks/store.js";
import type { Finding, TaskFileV2, TaskPipelinePhase } from "../../src/tasks/types.js";
import { loadWorkItem } from "../../src/work-items/io.js";
import { ensureWorkItemHydrated } from "../../src/work-items/rehydrate.js";
import { writeTaskFixture } from "../helpers/task-fixture.js";

// ASDLC-1/AC-13, ASDLC-1/TC-14.
// Contract pinned (spec leaves shapes open):
//  - Resume = ensureWorkItemHydrated(id) with cwd at the clone root and no `.tasks/`.
//  - restoreStateFromTree(id, cwd?) -> Result<{ restored: boolean; task_ids: number[] }>; restored is
//    false (ok) when docs/dev/<ID>/state/ holds nothing to restore; it never overwrites a live task file.
//  - "next ref" = allocateRef(task, <next agent>) over the restored task file, as in the original run.
setDefaultTimeout(120_000);

const ID = "ASDLC-1";
const TASK = 1;
const DEV = `docs/dev/${ID}`;
const TEST_FILE = "tests/foo.test.ts";
const SRC_FILE = "src/foo.ts";
const CFG = {
  test: { command: "bun test", file_pattern: "**/*.test.ts" },
  stack: { enabled: true, commits: "phase", state: { persist: "tree", redact: true } },
} as unknown as DevHarnessConfig;

interface Step {
  ref: string;
  agent: string;
  /** Files the agent writes before its commit. */
  files: Array<[string, string]>;
  /** Findings the review raises (review agents only). */
  raise?: Array<{ severity: "warning" | "suggestion"; issue: string }>;
  /** Findings of an earlier raising ref that this step addresses. */
  address?: string;
  after: { phase: TaskPipelinePhase; round: string };
  retry?: "test_review" | "code_review";
}

const STEPS: Step[] = [
  {
    ref: "T1/phase-test",
    agent: "phase-test",
    files: [[TEST_FILE, "// red\n"]],
    after: { phase: "review-test", round: "T1" },
  },
  {
    ref: "T1/review-test",
    agent: "review-test",
    files: [],
    raise: [{ severity: "warning", issue: "weak assertion in foo" }],
    after: { phase: "phase-test", round: "T2" },
    retry: "test_review",
  },
  {
    ref: "T2/phase-test",
    agent: "phase-test",
    files: [[TEST_FILE, "// red, stronger\n"]],
    address: "T1/review-test",
    after: { phase: "review-test", round: "T2" },
  },
  {
    ref: "T2/review-test",
    agent: "review-test",
    files: [],
    after: { phase: "phase-code", round: "C1" },
  },
  {
    ref: "C1/phase-code",
    agent: "phase-code",
    files: [[SRC_FILE, "export const foo = 1;\n"]],
    after: { phase: "review-code", round: "C1" },
  },
  {
    ref: "C1/review-code",
    agent: "review-code",
    files: [],
    raise: [{ severity: "warning", issue: "naming in foo" }],
    after: { phase: "phase-code", round: "C2" },
    retry: "code_review",
  },
  {
    ref: "C2/phase-code",
    agent: "phase-code",
    files: [[SRC_FILE, "export const foo = 2;\n"]],
    address: "C1/review-code",
    after: { phase: "review-code", round: "C2" },
  },
  {
    ref: "C2/review-code",
    agent: "review-code",
    files: [],
    after: { phase: "phase-verify-task", round: "V1" },
  },
  {
    ref: "V1/phase-verify-task",
    agent: "phase-verify-task",
    files: [],
    after: { phase: "phase-verify-task", round: "V1" },
  },
];

let originalCwd: string;
let sandbox: string;
let origin: string;
let errSpy: ReturnType<typeof spyOn>;
let priorLevel: ReturnType<typeof getLogLevel>;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}
function write(root: string, file: string, content: string): void {
  mkdirSync(dirname(join(root, file)), { recursive: true });
  writeFileSync(join(root, file), content);
}
function configure(root: string): void {
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  git(root, "config", "commit.gpgsign", "false");
}

function reviewPacket(step: Step): Record<string, unknown> {
  const findings = (step.raise ?? []).map((raised) => ({
    severity: raised.severity,
    issue: raised.issue,
    file: step.agent === "review-test" ? TEST_FILE : SRC_FILE,
    recommendation: "fix it",
  }));
  return {
    verdict: findings.length ? "issues" : "clean",
    findings,
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  };
}
function packetFor(step: Step): Record<string, unknown> {
  if (step.agent.startsWith("review-")) return reviewPacket(step);
  if (step.agent === "phase-verify-task") {
    return { status: "done", usage: { prompt_tokens: 1, completion_tokens: 1 } };
  }
  const kind = step.agent === "phase-test" ? "test" : "code";
  return {
    status: "done",
    changes: step.files.map(([file]) => ({ file, action: "add", kind, ac_ids: ["AC-13"] })),
    ...(step.agent === "phase-test" ? { red_confirmed: true } : {}),
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  };
}

function applyToTask(task: TaskFileV2, step: Step, index: number): void {
  const at = `2026-01-01T00:0${String(index)}:00.000Z`;
  task.control.status = "in_progress";
  task.log.push({
    ref: step.ref,
    at,
    result: step.agent.startsWith("review-") ? String(reviewPacket(step).verdict) : "done",
    note: `${step.agent} complete`,
  });
  const requirement = task.requirements[0];
  if (!requirement) throw new Error("fixture task has no requirement");
  for (const [findingIndex, raised] of (step.raise ?? []).entries()) {
    const finding: Finding = {
      id: `F-${step.ref.replace("/", "-")}-${String(findingIndex + 1)}`,
      state: "open",
      severity: raised.severity === "warning" ? "warning" : "suggestion",
      loop: step.agent === "review-test" ? "T" : "C",
      issue: raised.issue,
      raised: step.ref,
      history: [],
    };
    requirement.findings.push(finding);
  }
  if (step.address) {
    for (const finding of requirement.findings) {
      if (finding.raised === step.address) {
        finding.history.push({ by: step.ref, outcome: "fixed", note: "addressed" });
      }
    }
  }
  if (step.retry) {
    const counter = task.control.retries[step.retry];
    counter.used += 1;
    counter.lifetime += 1;
  }
  task.control.phase = step.after.phase;
  task.control.round = step.after.round;
}

async function runStep(root: string, index: number, taskId = TASK): Promise<void> {
  const step = STEPS[index] as Step;
  for (const [file, content] of step.files) write(root, file, content);
  mutateTaskV2(ID, taskId, (task) => {
    applyToTask(task, step, index);
    return true;
  });
  const result = await tryCommitPhase(ID, taskId, step.ref, step.agent, packetFor(step), CFG, root);
  expect(result.ok).toBe(true);
}

function normalise(task: TaskFileV2): Record<string, unknown> {
  const { owner_nonce: _nonce, in_flight: _inFlight, ...control } = task.control;
  return JSON.parse(
    JSON.stringify({ control, requirements: task.requirements, log: task.log, title: task.title }),
  );
}

interface Marker {
  sha: string;
  task: Record<string, unknown>;
  resolution: { outcome: string; agent?: string };
  /** Active primary task id at the origin (null when every task is terminal). */
  active: number | null;
}

let markers: Marker[] = [];
let evidenceSha = "";

function activeOf(): number | null {
  return resolveActivePrimaryTaskId(
    loadWorkItem(ID) as NonNullable<ReturnType<typeof loadWorkItem>>,
  );
}

function resolutionOf(): { outcome: string; agent?: string } {
  const resolution = resolveResumeOrchestration(ID, CFG);
  return resolution.outcome === "spawn"
    ? { outcome: "spawn", agent: resolution.agent }
    : { outcome: resolution.outcome };
}

function seedOrigin(taskIds: number[] = [TASK]): void {
  process.chdir(origin);
  git(origin, "init", "-q", "--initial-branch=main");
  configure(origin);
  write(origin, ".gitignore", ".tasks/\n");
  write(origin, "README.md", "# repo\n");
  write(origin, `${DEV}/brief.md`, `# ${ID}\n\nbrief\n`);
  write(
    origin,
    `${DEV}/spec.json`,
    JSON.stringify({
      schema_version: "1.0",
      work_item_id: ID,
      title: "State resume fixture",
      date: "2026-01-01",
      problem_statement: "p",
      proposed_solution: "s",
      // biome-ignore lint/suspicious/noThenProperty: spec schema Gherkin field name
      acceptance_criteria: [{ id: "AC-13", given: "g", when: "w", then: "t" }],
      scope: { in: ["x"], out: [] },
      verification: { commands: ["true"], test_cases: [] },
    }),
  );
  write(
    origin,
    `${DEV}/plan.json`,
    JSON.stringify({
      schema_version: "1.0",
      work_item_id: ID,
      spec: `${DEV}/spec.json`,
      tasks: taskIds.map((id) => ({ id, title: `Task ${String(id)}`, covers_ac: ["AC-13"] })),
    }),
  );
  const workItem = {
    schema_version: "1.0",
    id: ID,
    title: "State resume fixture (live title)",
    created: "2026-01-01T00:00:00.000Z",
    updated: "2026-01-01T00:00:00.000Z",
    pattern: "implement",
    variant: "standard",
    phase: "implementing",
    brief: `${DEV}/brief.md`,
    spec: `${DEV}/spec.json`,
    plan: `${DEV}/plan.json`,
    verify: null,
    task_ids: taskIds,
    decisions: [],
    deviations: [],
    cost_usd: 1.25,
    intent_mode: "pipeline",
    intent_confidence: "high",
    escalation_ceiling: "pipeline_allowed",
  };
  mkdirSync(join(origin, ".tasks"), { recursive: true });
  writeFileSync(join(origin, ".tasks", `${ID}.json`), `${JSON.stringify(workItem, null, 2)}\n`);
  // Mirrors the contract PR0 commit, which persists the work item under state/.
  write(origin, `${DEV}/state/work-item.json`, `${JSON.stringify(workItem, null, 2)}\n`);
  for (const taskId of taskIds) {
    writeTaskFixture(
      {
        workItemId: ID,
        taskId,
        ownerNonce: "a1b2c3",
        coversAc: ["AC-13"],
        testCases: { "AC-13": ["TC-14"] },
      },
      origin,
    );
  }
  git(origin, "add", ".");
  git(origin, "commit", "-q", "-m", "init");
}

async function recordOrigin(): Promise<void> {
  seedOrigin();
  markers = [];
  for (const index of STEPS.keys()) {
    await runStep(origin, index);
    markers.push({
      sha: git(origin, "rev-parse", "HEAD").trim(),
      task: normalise(loadTaskV2(ID, String(TASK)) as TaskFileV2),
      resolution: resolutionOf(),
      active: activeOf(),
    });
  }
  mutateTaskV2(ID, TASK, (task) => {
    task.control.status = "done";
    return true;
  });
  const evidence = await commitTaskEvidence(ID, [TASK], CFG, origin);
  expect(evidence.ok).toBe(true);
  evidenceSha = git(origin, "rev-parse", "HEAD").trim();
}

const MULTI_TASKS = [1, 2, 3];
const MULTI_STEPS = 3; // task 2 is recorded through T1/phase-test, T1/review-test, T2/phase-test

/** Task 1 finished with evidence; task 2 running; task 3 not started. */
async function recordMultiOrigin(): Promise<void> {
  seedOrigin(MULTI_TASKS);
  markers = [];
  for (const index of STEPS.keys()) await runStep(origin, index, 1);
  mutateTaskV2(ID, 1, (task) => {
    task.control.status = "done";
    return true;
  });
  const evidence = await commitTaskEvidence(ID, [1], CFG, origin);
  expect(evidence.ok).toBe(true);
  for (let index = 0; index < MULTI_STEPS; index += 1) {
    await runStep(origin, index, 2);
    markers.push({
      sha: git(origin, "rev-parse", "HEAD").trim(),
      task: normalise(loadTaskV2(ID, "2") as TaskFileV2),
      resolution: resolutionOf(),
      active: activeOf(),
    });
  }
}

function freshCloneAt(sha: string, name: string): string {
  const dest = join(sandbox, name);
  git(sandbox, "clone", "-q", origin, dest);
  git(dest, "checkout", "-q", sha);
  configure(dest);
  rmSync(join(dest, ".tasks"), { recursive: true, force: true });
  expect(existsSync(join(dest, ".tasks"))).toBe(false);
  return dest;
}

beforeEach(() => {
  priorLevel = getLogLevel();
  setLogLevel("error");
  errSpy = spyOn(console, "error").mockImplementation(() => {});
  originalCwd = process.cwd();
  sandbox = realpathSync(mkdtempSync(join(tmpdir(), "accord-state-resume-")));
  origin = join(sandbox, "origin");
  mkdirSync(origin, { recursive: true });
});

afterEach(() => {
  process.chdir(originalCwd);
  errSpy.mockRestore();
  setLogLevel(priorLevel);
  rmSync(sandbox, { recursive: true, force: true });
});

describe("ASDLC-1/AC-13 stateless resume from committed state (ASDLC-1/TC-14)", () => {
  it("ASDLC-1/AC-13 fixture run records one typed commit per phase before the evidence commit", async () => {
    await recordOrigin();
    expect(markers).toHaveLength(STEPS.length);
    expect(new Set(markers.map((marker) => marker.sha)).size).toBe(STEPS.length);
    // Origin routing is a known spawn at every typed commit (never blocked/done), so the
    // clone comparison below is against a real next action, not blocked === blocked.
    expect(markers.map((marker) => marker.resolution)).toEqual(
      [
        "review-test",
        "phase-test",
        "review-test",
        "review-test",
        "review-code",
        "review-test",
        "review-code",
        "phase-verify-task",
        "phase-verify-task",
      ].map((agent) => ({ outcome: "spawn", agent })),
    );
    for (const [index, marker] of markers.entries()) {
      const body = git(origin, "show", "-s", "--format=%B", marker.sha);
      expect(body).toContain(`ref=${(STEPS[index] as Step).ref}`);
    }
    expect(git(origin, "show", "-s", "--format=%B", evidenceSha)).toContain("evidence(task-1)");
  });

  it("ASDLC-1/AC-13 resume at every typed commit rebuilds the same task state and next ref with no review re-run", async () => {
    await recordOrigin();
    for (const [index, marker] of markers.entries()) {
      const clone = freshCloneAt(marker.sha, `resume-${String(index)}`);
      process.chdir(clone);

      const hydrated = ensureWorkItemHydrated(ID);
      expect(hydrated.ok).toBe(true);
      if (!hydrated.ok) continue;
      expect(hydrated.value.rehydrated).toBe(true);

      const restored = loadTaskV2(ID, String(TASK)) as TaskFileV2;
      expect(restored).not.toBeNull();
      // State, log, retries, phase, round and findings all come from the committed tree.
      expect(normalise(restored)).toEqual(marker.task);
      expect(restored.control.in_flight).toBeNull();

      // Next ref is the next original step's ref (a review is never re-run).
      const next = STEPS[index + 1];
      if (next) {
        expect(allocateRef(restored, next.agent)).toBe(next.ref);
      }
      const doneRefs = restored.log.map((entry) => entry.ref);
      expect(doneRefs).toEqual(STEPS.slice(0, index + 1).map((step) => step.ref));

      const resolution = resolutionOf();
      expect(resolution).toEqual(marker.resolution);
      if (resolution.agent?.startsWith("review-")) {
        // A review is only dispatched when its own ref is not yet in the restored log.
        const reviewRef = allocateRef(restored, resolution.agent);
        expect(doneRefs).not.toContain(reviewRef);
      }
    }
  });

  it("ASDLC-1/AC-13 work item is rebuilt from state/work-item.json when .tasks/ is gone", async () => {
    await recordOrigin();
    const clone = freshCloneAt(markers[2]?.sha as string, "resume-wi");
    process.chdir(clone);
    expect(ensureWorkItemHydrated(ID).ok).toBe(true);
    const wi = JSON.parse(readFileSync(join(clone, ".tasks", `${ID}.json`), "utf8"));
    expect(wi.id).toBe(ID);
    // Distinct from spec.json's title and from rehydrate's zero cost: only state/work-item.json has these.
    expect(wi.title).toBe("State resume fixture (live title)");
    expect(wi.cost_usd).toBe(1.25);
    expect(wi.pattern).toBe("implement");
    expect(wi.task_ids).toEqual([TASK]);
    expect(wi.phase).toBe("implementing");
  });

  it("ASDLC-1/AC-13 review findings are read from the tree: open then addressed findings survive restore", async () => {
    await recordOrigin();
    // After T1/review-test (index 1) the warning is open; after T2/phase-test (index 2) it is fixed.
    for (const [index, expectedState] of [
      [1, "open"],
      [2, "addressed"],
    ] as const) {
      const clone = freshCloneAt(markers[index]?.sha as string, `findings-${String(index)}`);
      process.chdir(clone);
      expect(ensureWorkItemHydrated(ID).ok).toBe(true);
      const restored = loadTaskV2(ID, String(TASK)) as TaskFileV2;
      const finding = restored.requirements[0]?.findings.find(
        (candidate) => candidate.raised === "T1/review-test",
      );
      expect(finding?.issue).toBe("weak assertion in foo");
      expect(finding?.severity).toBe("warning");
      expect(finding?.state).toBe(expectedState);
      const reviewFile = `${DEV}/reviews/task-${String(TASK)}/T1-review-test.md`;
      const reviewMd = readFileSync(join(clone, reviewFile), "utf8");
      expect(reviewMd).toContain(`warning: ${finding?.issue}`);
      expect(reviewMd).toContain(`- file: ${TEST_FILE}`);
    }
  });

  it("ASDLC-1/AC-13 evidence asset regenerated after resume + replay equals the committed asset byte for byte", async () => {
    await recordOrigin();
    const committedMd = git(
      origin,
      "show",
      `${evidenceSha}:${DEV}/evidence/task-${String(TASK)}.md`,
    );
    const committedJson = git(
      origin,
      "show",
      `${evidenceSha}:${DEV}/evidence/task-${String(TASK)}.json`,
    );
    expect(committedMd.length).toBeGreaterThan(0);

    for (const [index, marker] of markers.entries()) {
      const clone = freshCloneAt(marker.sha, `asset-${String(index)}`);
      process.chdir(clone);
      expect(ensureWorkItemHydrated(ID).ok).toBe(true);
      // Replay the rest of the run from the restored state.
      for (let rest = index + 1; rest < STEPS.length; rest += 1) await runStep(clone, rest);
      mutateTaskV2(ID, TASK, (task) => {
        task.control.status = "done";
        return true;
      });
      const evidence = await commitTaskEvidence(ID, [TASK], CFG, clone);
      expect(evidence.ok).toBe(true);

      const assetMd = readFileSync(join(clone, DEV, "evidence", `task-${String(TASK)}.md`), "utf8");
      const assetJson = readFileSync(
        join(clone, DEV, "evidence", `task-${String(TASK)}.json`),
        "utf8",
      );
      expect(assetMd).toBe(committedMd);
      expect(assetJson).toBe(committedJson);
      // Regenerate from the last commit before the deletion (the one under the evidence commit).
      git(clone, "checkout", "-q", "HEAD~1");
      expect(git(clone, "show", "-s", "--format=%B", "HEAD")).not.toContain("evidence(task-1)");
      const [rebuilt] = await buildEvidenceAsset(ID, [TASK], { cwd: clone, config: CFG });
      expect(rebuilt?.md).toBe(committedMd);
      expect(JSON.stringify(rebuilt?.json)).toBe(JSON.stringify(JSON.parse(committedJson)));
    }
  });
});

describe("ASDLC-1/AC-13 restoreStateFromTree", () => {
  it("ASDLC-1/AC-13 restores work item and task file from state/ and reports the task ids", async () => {
    await recordOrigin();
    const clone = freshCloneAt(markers[5]?.sha as string, "restore-direct");
    const result = restoreStateFromTree(ID, clone);
    expect(result).toEqual({ ok: true, value: { restored: true, task_ids: [TASK] } });
    process.chdir(clone);
    expect(existsSync(join(clone, ".tasks", `${ID}.json`))).toBe(true);
    expect(normalise(loadTaskV2(ID, String(TASK)) as TaskFileV2)).toEqual(
      (markers[5] as Marker).task,
    );
  });

  it("ASDLC-1/AC-13 never overwrites an existing live task file", async () => {
    await recordOrigin();
    const clone = freshCloneAt(markers[5]?.sha as string, "restore-noclobber");
    process.chdir(clone);
    writeTaskFixture(
      { workItemId: ID, taskId: TASK, ownerNonce: "feed01", coversAc: ["AC-13"] },
      clone,
    );
    const livePath = join(clone, ".tasks", `${ID}-task-${String(TASK)}.json`);
    const liveWiPath = join(clone, ".tasks", `${ID}.json`);
    writeFileSync(
      liveWiPath,
      `${JSON.stringify({ id: ID, title: "live only", cost_usd: 9.5, task_ids: [TASK] })}\n`,
    );
    const before = readFileSync(livePath, "utf8");
    const beforeWi = readFileSync(liveWiPath, "utf8");
    const result = restoreStateFromTree(ID, clone);
    expect(result.ok).toBe(true);
    expect(readFileSync(livePath, "utf8")).toBe(before);
    expect(readFileSync(liveWiPath, "utf8")).toBe(beforeWi);
  });

  it("ASDLC-1/AC-13 reports nothing to restore when docs/dev/<ID>/state/ is absent", async () => {
    await recordOrigin();
    const clone = freshCloneAt(markers[5]?.sha as string, "restore-nostate");
    rmSync(join(clone, DEV, "state"), { recursive: true, force: true });
    const result = restoreStateFromTree(ID, clone);
    expect(result).toEqual({ ok: true, value: { restored: false, task_ids: [] } });
    expect(existsSync(join(clone, ".tasks", `${ID}-task-${String(TASK)}.json`))).toBe(false);
  });
});

describe("ASDLC-1/AC-13 multi-task resume (ASDLC-1/TC-14)", () => {
  it("ASDLC-1/AC-13 finished task is not re-run, running task resumes, not-started task is still bootstrapped", async () => {
    await recordMultiOrigin();
    expect(markers).toHaveLength(MULTI_STEPS);
    for (const marker of markers) expect(marker.active).toBe(2);
    expect(markers.map((marker) => marker.resolution.agent)).toEqual([
      "review-test",
      "phase-test",
      "review-test",
    ]);

    for (const [index, marker] of markers.entries()) {
      const clone = freshCloneAt(marker.sha, `multi-${String(index)}`);
      // finished task 1: evidence asset present, state/task-1 gone
      expect(existsSync(join(clone, DEV, "evidence", "task-1.md"))).toBe(true);
      expect(existsSync(join(clone, DEV, "state", "task-1"))).toBe(false);
      expect(existsSync(join(clone, DEV, "state", "task-2", "task.json"))).toBe(true);
      process.chdir(clone);

      expect(ensureWorkItemHydrated(ID).ok).toBe(true);
      const wi = loadWorkItem(ID) as NonNullable<ReturnType<typeof loadWorkItem>>;
      expect(wi.task_ids).toEqual(MULTI_TASKS);

      // task 1 must never be targeted again (not recreated as a fresh task)
      const finished = loadTaskV2(ID, "1");
      if (finished) expect(finished.control.status).toBe("done");
      expect(resolveActivePrimaryTaskId(wi)).toBe(2);
      expect(resolveActivePrimaryTaskId(wi)).toBe(marker.active);

      // running task 2 equals the origin snapshot and yields the same next ref
      const running = loadTaskV2(ID, "2") as TaskFileV2;
      expect(running).not.toBeNull();
      expect(normalise(running)).toEqual(marker.task);
      const next = STEPS[index + 1] as Step;
      expect(allocateRef(running, next.agent)).toBe(next.ref);
      expect(resolutionOf()).toEqual(marker.resolution);

      // not-started task 3 still exists and is not done
      const pending = loadTaskV2(ID, "3");
      expect(pending).not.toBeNull();
      expect(pending?.control.status).not.toBe("done");
    }
  });
});
