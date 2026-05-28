import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { formatIntentContractForTask } from "../src/core/briefing/intent-contract-brief.js";
import {
  buildDevHarnessConfig,
  detectMonorepo,
  detectProjectStack,
  detectTracker,
  findMonorepoRoot,
} from "../src/core/config/detect/index.js";
import { mergeContextSources, mergeOrchestrationConfig } from "../src/core/config/global.js";
import { devInitDetect } from "../src/core/config/init-detect.js";
import { notifyPendingDecisionsIfAny } from "../src/core/harness/index.js";
import { devTasks } from "../src/core/queries/dashboard.js";
import { extractReturnPacket } from "../src/core/subagent/index.js";
import type { PricingConfig } from "../src/core/telemetry/usage.js";
import {
  appendUsageLine,
  clearHarnessRunTag,
  computeLineCost,
  describeHarnessRunMeta,
  discoverWorkItems,
  ensureAutoHarnessRunMeta,
  normalizeUsageCostFields,
  pricingFor,
  recomputeCost,
  setHarnessRunTag,
} from "../src/core/telemetry/usage.js";
import { checkVerifyStaleness } from "../src/core/verification/staleness.js";
import {
  devCheckpointDelete,
  devCheckpointRead,
  devCheckpointWrite,
} from "../src/core/work-items/checkpoint.js";
import { writeJson } from "../src/core/work-items/io.js";
import { devBootstrap } from "../src/core/work-items/lifecycle.js";
import type { Checkpoint } from "../src/core/work-items/types.js";

const tempDirs: string[] = [];
const originalCwd = process.cwd();

function tempProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "accord-cov-"));
  tempDirs.push(dir);
  return dir;
}

function resetHarnessEnv(): void {
  delete process.env.DEV_HARNESS_RUN_TAG;
  delete process.env.DEV_HARNESS_RUN_ID;
}

afterEach(() => {
  process.chdir(originalCwd);
  resetHarnessEnv();
  while (tempDirs.length) {
    rmSync(tempDirs.pop()!, { recursive: true, force: true });
  }
});

describe("mergeContextSources", () => {
  test("empty global and project", () => {
    expect(mergeContextSources(undefined, undefined)).toEqual([]);
    expect(mergeContextSources([], [])).toEqual([]);
  });

  test("filters disabled entries from global-only merge", () => {
    const merged = mergeContextSources(
      [
        { type: "slack", enabled: true, channels: ["a"] },
        { type: "jira", enabled: false },
      ],
      undefined,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].type).toBe("slack");
  });

  test("project-only and project overrides global by type", () => {
    const projectOnly = mergeContextSources(undefined, [
      { type: "slack", space: "p", enabled: true },
    ]);
    expect(projectOnly).toEqual([{ type: "slack", space: "p", enabled: true }]);

    const merged = mergeContextSources(
      [{ type: "slack", channels: ["old"] }],
      [{ type: "slack", space: "new", channels: ["x"] }],
    );
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ type: "slack", space: "new", channels: ["x"] });
  });

  test("project can disable a global source", () => {
    const merged = mergeContextSources([{ type: "slack" }], [{ type: "slack", enabled: false }]);
    expect(merged).toEqual([]);
  });

  test("project can add a source not present globally", () => {
    const merged = mergeContextSources([{ type: "slack" }], [{ type: "wiki", path: "/x" }]);
    expect(merged.map((s) => s.type).sort()).toEqual(["slack", "wiki"]);
  });
});

describe("mergeOrchestrationConfig", () => {
  test("global resume/commit defaults merge with empty project", () => {
    const merged = mergeOrchestrationConfig(
      {
        resume: { no_auto_chain_agents: [], max_sequential_spawns: 32 },
        commit: { on_task_done: true },
      },
      undefined,
    );
    expect(merged?.resume?.no_auto_chain_agents).toEqual([]);
    expect(merged?.commit?.on_task_done).toBe(true);
  });

  test("project overrides global resume subsection", () => {
    const merged = mergeOrchestrationConfig(
      { resume: { no_auto_chain_agents: [], max_sequential_spawns: 32 } },
      { resume: { max_sequential_spawns: 4 } },
    );
    expect(merged?.resume?.max_sequential_spawns).toBe(4);
    expect(merged?.resume?.no_auto_chain_agents).toEqual([]);
  });
});

describe("devTasks dashboard", () => {
  test("empty project shows no work items", () => {
    const project = tempProject();
    process.chdir(project);
    const r = devTasks();
    expect(r.rows).toEqual([]);
    expect(r.formatted).toContain("No work items in `.tasks/`.");
  });

  test("aggregates tasks, decisions, deviations, and formatting", () => {
    const project = tempProject();
    process.chdir(project);
    devBootstrap("DASH-1", "t1", "implement", "standard");
    const wiPath = join(".tasks", "DASH-1.json");
    const wi = JSON.parse(readFileSync(wiPath, "utf8"));
    wi.task_ids = [1, 2, 3];
    wi.decisions = [
      {
        id: "d1",
        source: "u",
        status: "pending",
        question: "q?",
        asked_at: new Date().toISOString(),
      },
    ];
    wi.deviations = [{ task_id: 1, description: "x", reason: "y", at: new Date().toISOString() }];
    wi.cost_usd = 1.25;
    wi.updated = "2099-01-02T00:00:00.000Z";
    writeFileSync(wiPath, `${JSON.stringify(wi, null, 2)}\n`);

    writeJson(join(".tasks", "DASH-1-task-1.json"), { status: "done" });
    writeJson(join(".tasks", "DASH-1-task-2.json"), { status: "blocked" });
    writeJson(join(".tasks", "DASH-1-task-3.json"), { status: "in_progress" });

    devBootstrap("DASH-2", "t2", "quick_fix");
    const wi2 = JSON.parse(readFileSync(join(".tasks", "DASH-2.json"), "utf8"));
    wi2.updated = "2099-01-01T00:00:00.000Z";
    writeFileSync(join(".tasks", "DASH-2.json"), `${JSON.stringify(wi2, null, 2)}\n`);

    const r = devTasks();
    expect(r.rows).toHaveLength(2);
    const first = r.rows[0];
    expect(first.id).toBe("DASH-1");
    expect(first.pattern).toBe("implement/standard");
    expect(r.formatted).toMatch(/imp\/std/);
    expect(first.tasks_done).toBe(1);
    expect(first.tasks_total).toBe(3);
    expect(first.tasks_blocked).toBe(1);
    expect(first.tasks_in_progress).toBe(1);
    expect(first.pending_decisions).toBe(1);
    expect(first.pending_deviations).toBe(1);
    expect(first.deviations_total).toBe(1);
    expect(first.title).toBe("t1");
    expect(r.total_pending).toBe(1);
    expect(r.total_pending_deviations).toBe(1);
    expect(r.total_blocked_tasks).toBe(1);
    expect(r.total_cost).toBeCloseTo(1.25, 2);
    expect(r.attention_summary).toContain("pending decision");
    expect(r.attention_summary).toContain("blocked task");
    expect(r.formatted).toMatch(/DASH-1/);
    expect(r.formatted).toMatch(/1\/3·1b·1↑/);
    expect(r.formatted).toMatch(/ID\s+PAT/);
    expect(first.phase).toBe("aligning");
    expect(r.formatted).toMatch(/\/dev review/);
  });
});

describe("checkpoint helpers", () => {
  test("write read delete round-trip", () => {
    const project = tempProject();
    process.chdir(project);
    mkdirSync(".tasks", { recursive: true });

    const data: Checkpoint = {
      schema_version: "0.9",
      phase: "planning",
      draft: { notes: "n" },
    } as Checkpoint;

    const { path: p } = devCheckpointWrite("CP-1", data);
    expect(existsSync(p)).toBe(true);

    const readBack = devCheckpointRead("CP-1");
    expect(readBack?.schema_version).toBe("1.0");
    expect(readBack?.phase).toBe("planning");

    expect(devCheckpointDelete("CP-1")).toBe(true);
    expect(devCheckpointRead("CP-1")).toBeNull();
    expect(devCheckpointDelete("CP-1")).toBe(false);
  });
});

describe("intent contract brief", () => {
  test("returns empty when no id or no intent fields", () => {
    expect(formatIntentContractForTask("no id here")).toBe("");
    const project = tempProject();
    process.chdir(project);
    devBootstrap("INT-1", "x", "quick_fix");
    expect(formatIntentContractForTask("work on INT-1 please")).toBe("");
  });

  test("includes intent fields when present", () => {
    const project = tempProject();
    process.chdir(project);
    devBootstrap("INT-2", "x", "quick_fix", undefined, {
      intent_mode: "narrow_change",
      escalation_ceiling: "file",
      target_paths: ["src/a.ts"],
      out_of_scope: ["b"],
      expected_finish: "tests pass",
    });
    const out = formatIntentContractForTask("INT-2");
    expect(out).toContain("intent_mode: narrow_change");
    expect(out).toContain("escalation_ceiling: file");
    expect(out).toContain("target_paths: src/a.ts");
    expect(out).toContain("out_of_scope: b");
    expect(out).toContain("expected_finish: tests pass");
  });
});

describe("verify staleness", () => {
  test("fails when spec or plan missing", () => {
    const project = tempProject();
    process.chdir(project);
    expect(checkVerifyStaleness("ST-1").ok).toBe(false);
  });

  test("detects stale verify when spec is newer", () => {
    const project = tempProject();
    process.chdir(project);
    const base = join("docs", "dev", "ST-2");
    mkdirSync(base, { recursive: true });
    const specPath = join(base, "spec.json");
    const planPath = join(base, "plan.json");
    const verifyPath = join(base, "verify.json");

    const old = new Date(Date.now() - 5_000);
    writeFileSync(verifyPath, "{}", "utf8");
    utimesSync(verifyPath, old, old);

    writeFileSync(specPath, "{}", "utf8");
    writeFileSync(planPath, "{}", "utf8");

    const check = checkVerifyStaleness("ST-2");
    expect(check.ok).toBe(false);
    expect(check.reason).toMatch(/stale/);
  });

  test("ok when verify missing or fresh", () => {
    const project = tempProject();
    process.chdir(project);
    const base = join("docs", "dev", "ST-3");
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, "spec.json"), "{}", "utf8");
    writeFileSync(join(base, "plan.json"), "{}", "utf8");
    expect(checkVerifyStaleness("ST-3").ok).toBe(true);

    writeFileSync(join(base, "verify.json"), "{}", "utf8");
    expect(checkVerifyStaleness("ST-3").ok).toBe(true);
  });
});

describe("stack / monorepo / init detect", () => {
  test("detectProjectStack returns null for empty dir", () => {
    const project = tempProject();
    expect(detectProjectStack(project)).toBeNull();
  });

  test("typescript vs javascript from package.json markers", () => {
    const tsDir = tempProject();
    writeFileSync(
      join(tsDir, "package.json"),
      JSON.stringify({ name: "x", version: "1.0.0" }),
      "utf8",
    );
    writeFileSync(join(tsDir, "tsconfig.json"), "{}", "utf8");
    expect(detectProjectStack(tsDir)?.language).toBe("typescript");

    const jsDir = tempProject();
    writeFileSync(
      join(jsDir, "package.json"),
      JSON.stringify({ name: "x", version: "1.0.0" }),
      "utf8",
    );
    expect(detectProjectStack(jsDir)?.language).toBe("javascript");
  });

  test("go.mod and .csproj detection", () => {
    const goDir = tempProject();
    writeFileSync(join(goDir, "go.mod"), "module example.com/x\n", "utf8");
    expect(detectProjectStack(goDir)?.language).toBe("go");

    const csDir = tempProject();
    writeFileSync(join(csDir, "App.csproj"), "<Project></Project>", "utf8");
    expect(detectProjectStack(csDir)?.language).toBe("csharp");
  });

  test("detectMonorepo markers and npm workspaces", () => {
    const pnpmDir = tempProject();
    writeFileSync(join(pnpmDir, "pnpm-workspace.yaml"), "packages:\n  - 'packages/*'\n", "utf8");
    expect(detectMonorepo(pnpmDir)?.tool).toContain("pnpm");

    const wsDir = tempProject();
    writeFileSync(
      join(wsDir, "package.json"),
      JSON.stringify({ name: "r", version: "1.0.0", workspaces: ["pkg/*"] }),
      "utf8",
    );
    expect(detectMonorepo(wsDir)?.tool).toContain("workspaces");
  });

  test("findMonorepoRoot walks up from nested directory", () => {
    const root = tempProject();
    mkdirSync(join(root, ".git"), { recursive: true });
    writeFileSync(join(root, "turbo.json"), "{}\n", "utf8");
    const nested = join(root, "packages", "a");
    mkdirSync(nested, { recursive: true });
    const found = findMonorepoRoot(nested);
    expect(found?.tool).toBe("turbo");
    expect(found?.root).toBeDefined();
    expect(resolve(found!.root)).toBe(resolve(root));
  });

  test("detectTracker reads .jira and work item id prefix", () => {
    const jiraDir = tempProject();
    writeFileSync(join(jiraDir, ".jira"), "", "utf8");
    expect(detectTracker(jiraDir)?.type).toBe("jira");

    const tasksDir = tempProject();
    mkdirSync(join(tasksDir, ".tasks"), { recursive: true });
    // detectTracker only scans *.json filenames without "-" (excludes WI-123.json).
    writeFileSync(
      join(tasksDir, ".tasks", "bootstrap.json"),
      JSON.stringify({ id: "ABC-99", phase: "x", pattern: "quick_fix" }),
      "utf8",
    );
    const t = detectTracker(tasksDir);
    expect(t?.type).toBe("jira");
    expect(t?.project_prefix).toBe("ABC");
  });

  test("devInitDetect empty vs minimal TS project", () => {
    const empty = tempProject();
    const noProj = devInitDetect(empty);
    expect(noProj.ok).toBe(false);
    if (noProj.ok) throw new Error("expected detection failure for empty project");
    expect(noProj.error.formatted_summary).toMatch(/No recognised project files/);

    const ts = tempProject();
    writeFileSync(
      join(ts, "package.json"),
      JSON.stringify({ name: "x", version: "1.0.0" }),
      "utf8",
    );
    writeFileSync(join(ts, "tsconfig.json"), "{}\n", "utf8");
    const det = devInitDetect(ts);
    expect(det.ok).toBe(true);
    if (!det.ok) throw new Error(det.error.message);
    expect(det.value.proposed_config.language).toBe("typescript");
    expect(det.value.formatted_summary).toContain(ts);
    expect(det.value.detection_notes.length).toBeGreaterThan(0);
  });

  test("buildDevHarnessConfig applies Makefile test override", () => {
    const dir = tempProject();
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ name: "x", version: "1.0.0", scripts: {} }),
      "utf8",
    );
    writeFileSync(join(dir, "tsconfig.json"), "{}\n", "utf8");
    writeFileSync(join(dir, "Makefile"), "test:\n\t@echo ok\n", "utf8");
    const built = buildDevHarnessConfig(dir);
    expect(built?.config.test.command).toBe("make test");
    expect(built?.notes.some((n) => n.includes("Makefile overrides"))).toBe(true);
  });
});

describe("usage helpers", () => {
  test("extractReturnPacket parses fenced JSON or trailing object", () => {
    expect(extractReturnPacket("")).toBeNull();
    const fenced = '```json\n{"status":"ok"}\n```';
    expect(extractReturnPacket(fenced)).toEqual({ status: "ok" });

    const badFenceThenBare = 'intro\n```json\nnot-json\n```\nmore text {"verdict": "pass"}\n';
    expect(extractReturnPacket(badFenceThenBare)).toEqual({ verdict: "pass" });
  });

  test("normalizeUsageCostFields reads nested cost.total", () => {
    const u = normalizeUsageCostFields({ input: 1, output: 2, cost: { total: 0.42 } });
    expect(u.cost).toBeCloseTo(0.42, 5);
  });

  test("recomputeCost and computeLineCost respect explicit usage.cost", () => {
    const project = tempProject();
    process.chdir(project);
    const pricing: PricingConfig = {
      unit: "usd_per_million_tokens",
      default: { input: 3, output: 15 },
      models: {},
    };
    appendUsageLine("USD-1", {
      at: new Date().toISOString(),
      work_item_id: "USD-1",
      subagent_type: "orchestrator",
      model: "m1",
      usage: normalizeUsageCostFields({ input: 0, output: 0, cost: 2.5 }),
    });
    expect(recomputeCost("USD-1", pricing)).toBeCloseTo(2.5, 5);

    // Pin the assumption: "unknown" is not in pricing.models, so pricingFor
    // must return the default rates. If pricingFor ever gains a fuzzy match,
    // the cost calculation below would drift silently.
    expect(pricingFor(pricing, "unknown")).toEqual(pricing.default);

    const lineCost = computeLineCost(
      {
        at: "",
        work_item_id: "x",
        subagent_type: "x",
        model: "unknown",
        usage: {
          input: 1_000_000,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0,
          contextTokens: 0,
          turns: 0,
        },
      },
      pricing,
    );
    expect(lineCost).toBeCloseTo(3, 5);
  });

  test("pricingFor matches namespaced model keys", () => {
    const pricing: PricingConfig = {
      unit: "x",
      default: { input: 1, output: 2 },
      models: { "acme/foo.bar": { input: 10, output: 20 } },
    };
    expect(pricingFor(pricing, "vendor/acme/foo.bar")).toEqual({ input: 10, output: 20 });
  });

  test("harness run meta file and env describe paths", () => {
    const project = tempProject();
    process.chdir(project);
    expect(describeHarnessRunMeta()).toMatch(/No harness run tag/);

    setHarnessRunTag("my-run");
    const d = describeHarnessRunMeta();
    expect(d).toContain("my-run");
    expect(d).toContain("run_id:");

    resetHarnessEnv();
    process.env.DEV_HARNESS_RUN_TAG = "envtag";
    expect(describeHarnessRunMeta()).toContain("environment overrides");

    resetHarnessEnv();
    clearHarnessRunTag();
    expect(existsSync(join(".tasks", ".harness-run.json"))).toBe(false);
  });

  test("ensureAutoHarnessRunMeta appends second work item id", () => {
    const project = tempProject();
    process.chdir(project);
    resetHarnessEnv();
    ensureAutoHarnessRunMeta("A-1");
    ensureAutoHarnessRunMeta("A-1");
    ensureAutoHarnessRunMeta("B-2");
    const raw = JSON.parse(readFileSync(join(".tasks", ".harness-run.json"), "utf8"));
    expect(raw.work_item_ids).toEqual(["A-1", "B-2"]);
    clearHarnessRunTag();
  });

  test("discoverWorkItems skips non-work-item files", () => {
    const project = tempProject();
    process.chdir(project);
    mkdirSync(".tasks", { recursive: true });
    writeFileSync(join(".tasks", "note.txt"), "x", "utf8");
    expect(discoverWorkItems()).toEqual([]);
  });
});

describe("notify pending decisions", () => {
  test("warns when decisions are pending (singular vs plural)", () => {
    const project = tempProject();
    process.chdir(project);
    devBootstrap("PEND-1", "x", "quick_fix");
    const wiPath = join(".tasks", "PEND-1.json");
    const wi = JSON.parse(readFileSync(wiPath, "utf8"));
    wi.decisions = [
      {
        id: "1",
        source: "s",
        status: "pending",
        question: "?",
        asked_at: new Date().toISOString(),
      },
    ];
    writeFileSync(wiPath, `${JSON.stringify(wi, null, 2)}\n`);

    const one: string[] = [];
    notifyPendingDecisionsIfAny({ notify: (_l, m) => one.push(m) });
    expect(one[0]).toMatch(/1 pending decision[^s]/);

    wi.decisions.push({
      id: "2",
      source: "s",
      status: "pending",
      question: "?",
      asked_at: new Date().toISOString(),
    });
    writeFileSync(wiPath, `${JSON.stringify(wi, null, 2)}\n`);
    const two: string[] = [];
    notifyPendingDecisionsIfAny({ notify: (_l, m) => two.push(m) });
    expect(two[0]).toMatch(/2 pending decisions/);
  });
});
