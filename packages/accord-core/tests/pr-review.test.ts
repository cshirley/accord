import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  anchorableLines,
  assertShardPartition,
  buildPendingReviewPayload,
  buildPrManifest,
  buildPrReviewTasks,
  capUntrustedSeverity,
  checkPrCoverage,
  DEFAULT_SHARD_BUDGET_BYTES,
  DEFAULT_SINGLE_SHARD_MAX_FILES,
  isGeneratedReviewFile,
  mergeFindingsByLocation,
  type PrFileDiff,
  planPrShards,
  splitDiffByFile,
  synthesizePrReviewReport,
  writePrShardFiles,
} from "../src/review/pr.js";

const fileDiff = (path: string, lines: string[], start = 1): string =>
  `diff --git a/${path} b/${path}\nnew file mode 100644\n--- /dev/null\n+++ b/${path}\n@@ -0,0 +${String(start)},${String(lines.length)} @@\n${lines.map((l) => `+${l}`).join("\n")}\n`;

const mkFile = (path: string, size = 100): PrFileDiff => {
  const diff = fileDiff(path, ["x".repeat(size)]);
  return { path, diff, bytes: Buffer.byteLength(diff) };
};

describe("splitDiffByFile", () => {
  test("one entry per file in order, bytes sum to the input", () => {
    const raw = fileDiff("a/one.ts", ["1"]) + fileDiff("b/two.ts", ["2", "3"]);
    const files = splitDiffByFile(raw);
    expect(files.map((f) => f.path)).toEqual(["a/one.ts", "b/two.ts"]);
    expect(files.reduce((n, f) => n + f.bytes, 0)).toBe(Buffer.byteLength(raw));
  });
  test("ignores text before the first diff header", () => {
    expect(splitDiffByFile("noise\n")).toEqual([]);
  });
});

describe("isGeneratedReviewFile", () => {
  test.each(["pnpm-lock.yaml", "x/y/package-lock.json", "a/segments.generated.ts", "a/b.snap"])(
    "skips %s",
    (p) => {
      expect(isGeneratedReviewFile(p)).toBe(true);
    },
  );
  test.each(["src/a.ts", "generated-notes.md", "lock.ts"])("reviews %s", (p) => {
    expect(isGeneratedReviewFile(p)).toBe(false);
  });
});

describe("planPrShards", () => {
  test("small diff is one shard", () => {
    const plan = planPrShards([mkFile("a/x.ts"), mkFile("a/y.ts")]);
    expect(plan.shards).toHaveLength(1);
  });

  test("defaults: a 33-file, ~127 KB PR is split; the single-shard limits are overridable", () => {
    expect(DEFAULT_SHARD_BUDGET_BYTES).toBe(60 * 1024);
    expect(DEFAULT_SINGLE_SHARD_MAX_FILES).toBe(20);
    const files = Array.from({ length: 33 }, (_, i) =>
      mkFile(`pkg/d${String(i % 6)}/f${String(i)}.ts`, 3_800),
    );
    expect(planPrShards(files).shards.length).toBeGreaterThan(1);
    // Same PR is a single shard when the caller raises both limits.
    expect(
      planPrShards(files, { budgetBytes: 200 * 1024, singleShardMaxFiles: 40 }).shards,
    ).toHaveLength(1);
    // Few files but over the byte budget still splits.
    const fat = [mkFile("a/x.ts", 50_000), mkFile("b/y.ts", 50_000)];
    expect(planPrShards(fat).shards.length).toBeGreaterThan(1);
  });

  test("large diff splits, keeps directories together, is a valid partition", () => {
    const files = [
      ...["a", "b", "c", "d", "e", "f"].map((n) => mkFile(`pkg/one/${n}.ts`, 30_000)),
      ...["a", "b", "c"].map((n) => mkFile(`pkg/two/${n}.ts`, 30_000)),
      mkFile("pnpm-lock.yaml", 500_000),
    ];
    const plan = planPrShards(files, { budgetBytes: 100_000, maxShards: 3 });
    expect(plan.shards.length).toBeGreaterThan(1);
    expect(plan.shards.length).toBeLessThanOrEqual(3);
    expect(plan.skipped).toEqual(["pnpm-lock.yaml"]);
    expect(() => assertShardPartition(files, plan)).not.toThrow();
    for (const dir of ["pkg/one/", "pkg/two/"]) {
      const holders = plan.shards.filter((s) => s.files.some((f) => f.startsWith(dir)));
      expect(holders).toHaveLength(1);
    }
  });

  test("a test file joins the shard of the source it is named for", () => {
    const files = [
      mkFile("src/auth/verify.ts", 60_000),
      mkFile("src/other/big.ts", 60_000),
      mkFile("test/verify.test.ts", 60_000),
    ];
    const plan = planPrShards(files, { budgetBytes: 80_000, maxShards: 2 });
    const shardOf = (p: string) => plan.shards.find((s) => s.files.includes(p))?.index;
    expect(shardOf("test/verify.test.ts")).toBe(shardOf("src/auth/verify.ts"));
  });

  test("same input gives the same shards", () => {
    const files = ["a", "b", "c", "d"].map((n) => mkFile(`d${n}/f.ts`, 50_000));
    const a = planPrShards(files, { budgetBytes: 60_000, maxShards: 4 });
    const b = planPrShards([...files].reverse(), { budgetBytes: 60_000, maxShards: 4 });
    expect(a.shards.map((s) => [...s.files].sort())).toEqual(
      b.shards.map((s) => [...s.files].sort()),
    );
  });

  test("an oversized file is kept whole and reported", () => {
    const plan = planPrShards([mkFile("a/huge.ts", 300_000), mkFile("b/s.ts")], {
      budgetBytes: 100_000,
    });
    expect(plan.oversized).toEqual(["a/huge.ts"]);
    expect(plan.shards.flatMap((s) => s.files)).toContain("a/huge.ts");
  });
});

describe("assertShardPartition", () => {
  const files = [mkFile("a.ts"), mkFile("b.ts")];
  const shard = (index: number, fs: string[]) => ({ index, files: fs, bytes: 0 });
  test("rejects a missing file", () => {
    expect(() =>
      assertShardPartition(files, { shards: [shard(1, ["a.ts"])], skipped: [], oversized: [] }),
    ).toThrow(/missing \[b.ts\]/);
  });
  test("rejects a duplicated file", () => {
    expect(() =>
      assertShardPartition(files, {
        shards: [shard(1, ["a.ts", "b.ts"]), shard(2, ["b.ts"])],
        skipped: [],
        oversized: [],
      }),
    ).toThrow(/duplicated \[b.ts\]/);
  });
  test("rejects a file that is not in the diff", () => {
    expect(() =>
      assertShardPartition(files, {
        shards: [shard(1, ["a.ts", "b.ts", "c.ts"])],
        skipped: [],
        oversized: [],
      }),
    ).toThrow(/unknown \[c.ts\]/);
  });
});

describe("shard files, manifest and briefs", () => {
  const pr = {
    number: 7,
    title: "Part 2",
    body: "does things",
    baseRefName: "packet/base",
    headRefOid: "abc123",
  };
  const files = [mkFile("a/x.ts", 80_000), mkFile("b/y.ts", 80_000), mkFile("b/y.test.ts", 10_000)];
  const plan = planPrShards(files, { budgetBytes: 100_000, maxShards: 2 });

  test("writes one file per shard containing exactly its diffs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pr-review-"));
    try {
      const paths = await writePrShardFiles(dir, files, plan);
      expect(paths).toHaveLength(plan.shards.length);
      for (const [i, shard] of plan.shards.entries()) {
        const text = await readFile(paths[i]!, "utf8");
        for (const f of files)
          expect(text.includes(`diff --git a/${f.path} `)).toBe(shard.files.includes(f.path));
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("manifest lists every shard and the skipped files", () => {
    const text = buildPrManifest({
      pr,
      plan: { ...plan, skipped: ["pnpm-lock.yaml"] },
      worktree: "/wt",
    });
    expect(text).toContain("## shard 1");
    expect(text).toContain("- pnpm-lock.yaml");
    expect(text).toContain("Worktree");
  });

  test("main wave has code+security per shard, test wave only review-test", () => {
    const shardPaths = plan.shards.map((s) => `/tmp/shard-${String(s.index)}.diff`);
    const main = buildPrReviewTasks({
      pr,
      plan,
      shardPaths,
      manifestPath: "/tmp/m.md",
      worktree: "/wt",
      wave: "main",
    });
    expect(main.every((t) => t.agent !== "review-test")).toBe(true);
    expect(main).toHaveLength(plan.shards.length * 2);
    for (const t of main) {
      expect(t.cwd).toBe("/wt");
      expect(t.task).toContain("files_reviewed");
      expect(t.task).toContain(`/tmp/shard-${String(t.shard)}.diff`);
      expect(t.task).not.toContain("x".repeat(50)); // never inlines the diff
    }
    const test = buildPrReviewTasks({
      pr,
      plan,
      shardPaths,
      manifestPath: "/tmp/m.md",
      worktree: "/wt",
      wave: "test",
      test_output: "(not run)",
    });
    expect(test.length).toBeGreaterThan(0);
    expect(test.every((t) => t.agent === "review-test")).toBe(true);
  });
});

const packet = (findings: object[], filesReviewed?: string[]): string =>
  `done\n\`\`\`json\n${JSON.stringify({ verdict: "issues", findings, ...(filesReviewed ? { files_reviewed: filesReviewed } : {}) })}\n\`\`\``;

describe("review lens", () => {
  const pr = { number: 7, title: "T", baseRefName: "base", headRefOid: "sha" };
  const files = [mkFile("a/x.ts", 5_000), mkFile("a/x.test.ts", 1_000)];
  const plan = planPrShards(files);
  const base = {
    pr,
    plan,
    shardPaths: ["/tmp/shard-1.diff"],
    manifestPath: "/tmp/m.md",
    worktree: "/wt",
  };

  test("each agent's brief carries its lens and the explicit return shape by default", () => {
    const main = buildPrReviewTasks({ ...base, wave: "main" });
    const security = main.find((t) => t.agent === "review-security")?.task ?? "";
    for (const stride of [
      "**S**poofing",
      "**T**ampering",
      "**R**epudiation",
      "**I**nformation disclosure",
      "**D**enial of service",
      "**E**levation of privilege",
    ]) {
      expect(security).toContain(stride);
    }
    expect(security).toContain("Availability counts");
    const code = main.find((t) => t.agent === "review-code")?.task ?? "";
    expect(code).toContain("Do not stop at ~15 findings");
    for (const t of main) {
      expect(t.task).toContain("files_reviewed");
      expect(t.task).toContain('"verdict"');
    }
    const test = buildPrReviewTasks({ ...base, wave: "test", test_output: "(not run)" });
    expect(test[0]?.task).toContain("Skip Check 0");
  });

  test("lens: false gives the bare brief", () => {
    const bare = buildPrReviewTasks({ ...base, wave: "main", lens: false });
    for (const t of bare) {
      expect(t.task).not.toContain("STRIDE");
      expect(t.task).not.toContain("Return packet (this review has no harness schema)");
      expect(t.task).toContain("files_reviewed"); // the coverage instruction is not part of the lens
    }
  });
});

describe("coverage and report", () => {
  const results = [
    {
      shard: 1,
      agent: "review-code",
      files: ["a/x.ts", "a/y.ts"],
      exitCode: 0,
      output: packet(
        [{ severity: "warning", message: "m1", file: "a/x.ts", line: 1 }],
        ["/wt/a/x.ts", "a/y.ts"],
      ),
    },
    {
      shard: 1,
      agent: "review-security",
      files: ["a/x.ts", "a/y.ts"],
      exitCode: 0,
      output: packet([], ["a/x.ts"]),
    },
    { shard: 2, agent: "review-code", files: ["b/z.ts"], exitCode: 0, output: packet([]) },
  ];

  test("reports missed files, and a missing files_reviewed as a gap", () => {
    const gaps = checkPrCoverage(results);
    expect(gaps).toContainEqual({
      shard: 1,
      agent: "review-security",
      missed: ["a/y.ts"],
      reported: true,
    });
    expect(gaps).toContainEqual({
      shard: 2,
      agent: "review-code",
      missed: ["b/z.ts"],
      reported: false,
    });
    expect(gaps.find((g) => g.shard === 1 && g.agent === "review-code")).toBeUndefined();
  });

  test("report merges shards, de-duplicates, and includes coverage", () => {
    const dup = {
      shard: 2,
      agent: "review-code",
      files: ["b/z.ts"],
      exitCode: 0,
      output: packet([{ severity: "warning", message: "m1", file: "a/x.ts", line: 1 }], ["b/z.ts"]),
    };
    const report = synthesizePrReviewReport([results[0]!, dup], {
      base: "packet/base",
      skipped: ["pnpm-lock.yaml"],
      shards: 2,
    });
    expect(report.findings.filter((f) => f.message === "m1")).toHaveLength(1);
    expect(report.formatted).toContain("### Coverage");
    expect(report.formatted).toContain("1 generated file(s) skipped");
  });

  test("a failed agent is listed and never reads as clean", () => {
    const failed = {
      shard: 1,
      agent: "review-code",
      files: ["a/x.ts"],
      exitCode: 1,
      output: "",
      stderr: "model_not_supported",
    };
    const report = synthesizePrReviewReport([failed], { base: "b", skipped: [], shards: 1 });
    expect(report.failures).toHaveLength(1);
    expect(report.formatted).toContain("Agent failures");
    expect(report.gaps).toHaveLength(1);
  });
});

describe("pending review payload", () => {
  const diff = `diff --git a/f.ts b/f.ts\n--- a/f.ts\n+++ b/f.ts\n@@ -10,3 +10,4 @@\n ctx\n-old\n+new1\n+new2\n ctx2\n`;
  const files = [{ path: "f.ts", diff, bytes: diff.length }];

  test("anchorableLines counts added and context lines on the head side", () => {
    expect([...anchorableLines(diff)]).toEqual([10, 11, 12, 13]);
  });

  test("anchors what it can, moves the rest to the body, and never sets an event", () => {
    const { payload, unanchored } = buildPendingReviewPayload({
      headSha: "abc",
      summary: "Draft",
      files,
      findings: [
        {
          severity: "warning",
          message: "on a changed line",
          file: "f.ts",
          line: 11,
          agent: "review-code",
        },
        {
          severity: "warning",
          message: "line not in diff",
          file: "f.ts",
          line: 99,
          agent: "review-code",
        },
        { severity: "suggestion", message: "no file", agent: "review-security" },
      ],
    });
    expect(payload.commit_id).toBe("abc");
    expect(payload.comments).toHaveLength(1);
    expect(payload.comments[0]).toMatchObject({ path: "f.ts", line: 11, side: "RIGHT" });
    expect(unanchored).toHaveLength(2);
    expect(payload.body).toContain("line not in diff");
    expect("event" in payload).toBe(false);
  });
});

describe("mergeFindingsByLocation", () => {
  const f = (agent: string, severity: string, message: string, file?: string, line?: number) => ({
    agent,
    severity,
    message,
    file,
    line,
  });

  test("findings at one file:line become one entry at the highest severity", () => {
    const out = mergeFindingsByLocation([
      f("review-code", "suggestion", "dup reader", "a.ts", 5),
      f("review-security", "warning", "unguarded", "a.ts", 5),
      f("review-code", "warning", "elsewhere", "a.ts", 9),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      file: "a.ts",
      line: 5,
      severity: "warning",
      agent: "review-security + review-code",
      merged: 2,
    });
    expect(out[0]?.message).toContain("dup reader");
    expect(out[0]?.message).toContain("unguarded");
    expect(out[1]?.merged).toBeUndefined();
  });

  test("a lone finding is returned untouched, and findings with no location are kept", () => {
    const lone = f("review-code", "warning", "x", "a.ts", 1);
    const nowhere = f("review-security", "suggestion", "general");
    const out = mergeFindingsByLocation([lone, nowhere, nowhere]);
    expect(out[0]).toBe(lone);
    expect(out).toHaveLength(3);
  });

  test("is idempotent", () => {
    const once = mergeFindingsByLocation([
      f("a", "warning", "m1", "x.ts", 2),
      f("b", "critical", "m2", "x.ts", 2),
    ]);
    expect(mergeFindingsByLocation(once)).toEqual(once);
  });

  test("the report lists shared locations once, and a payload posts one comment for them", () => {
    const out = (findings: object[]) =>
      `x\n\`\`\`json\n${JSON.stringify({ verdict: "issues", findings, files_reviewed: ["a.ts"] })}\n\`\`\``;
    const results = [
      {
        shard: 1,
        agent: "review-code",
        files: ["a.ts"],
        exitCode: 0,
        output: out([{ severity: "suggestion", message: "c", file: "a.ts", line: 2 }]),
      },
      {
        shard: 1,
        agent: "review-security",
        files: ["a.ts"],
        exitCode: 0,
        output: out([{ severity: "warning", message: "s", file: "a.ts", line: 2 }]),
      },
    ];
    const report = synthesizePrReviewReport(results, { base: "b", skipped: [], shards: 1 });
    expect(report.findings).toHaveLength(1);
    expect(report.formatted).toContain("### By location");
    expect(report.formatted).toContain("1 shared by more than one finding");
    const diff = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,2 +1,3 @@\n a\n+b\n c\n";
    const { payload } = buildPendingReviewPayload({
      headSha: "s",
      summary: "S",
      findings: report.findings,
      files: [{ path: "a.ts", diff, bytes: diff.length }],
    });
    expect(payload.comments).toHaveLength(1);
    expect(payload.comments[0]?.body).toContain("review-code");
    expect(payload.comments[0]?.body).toContain("review-security");
  });
});

describe("repeated runs", () => {
  const pr = { number: 7, title: "T", baseRefName: "base", headRefOid: "sha" };
  const files = [mkFile("a/x.ts", 5_000)];
  const plan = planPrShards(files);
  const base = {
    pr,
    plan,
    shardPaths: ["/tmp/shard-1.diff"],
    manifestPath: "/tmp/m.md",
    worktree: "/wt",
    wave: "main" as const,
  };

  test("runs repeats every task with a 1-based run number, capped at 3, default 1", () => {
    expect(buildPrReviewTasks(base).map((t) => t.run)).toEqual([1, 1]);
    const three = buildPrReviewTasks({ ...base, runs: 3 });
    expect(three).toHaveLength(6);
    expect([...new Set(three.map((t) => t.run))]).toEqual([1, 2, 3]);
    expect(buildPrReviewTasks({ ...base, runs: 9 })).toHaveLength(6);
    expect(buildPrReviewTasks({ ...base, runs: 0 })).toHaveLength(2);
  });

  const f = (
    run: number,
    line: number,
    severity: string,
    message: string,
    agent = "review-code",
  ) => ({ run, agent, severity, message, file: "a.ts", line });

  test("with a tolerance, the same issue a line or two apart merges across runs and records the runs", () => {
    const out = mergeFindingsByLocation(
      [
        f(1, 142, "critical", "crash"),
        f(2, 144, "warning", "crash again, longer text"),
        f(3, 143, "critical", "crash"),
      ],
      { tolerance: 2 },
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ severity: "critical", runs: [1, 2, 3], merged: 3 });
    expect(out[0]?.message.match(/review-code/g)).toHaveLength(1); // one agent: one text, not three
  });

  test("distant findings stay separate, and a lone finding keeps its run", () => {
    const out = mergeFindingsByLocation([f(1, 10, "warning", "a"), f(2, 40, "warning", "b")], {
      tolerance: 2,
    });
    expect(out).toHaveLength(2);
    expect(out[0]?.runs).toEqual([1]);
  });

  test("different agents at one location keep both texts", () => {
    const out = mergeFindingsByLocation([
      f(1, 5, "warning", "code view"),
      f(1, 5, "warning", "sec view", "review-security"),
    ]);
    expect(out[0]?.agent).toBe("review-code + review-security");
    expect(out[0]?.message).toContain("code view");
    expect(out[0]?.message).toContain("sec view");
  });

  test("the report counts locations reported in every run, and a comment says how many runs found it", () => {
    const out = (findings: object[]) =>
      `x\n\`\`\`json\n${JSON.stringify({ verdict: "issues", findings, files_reviewed: ["a.ts"] })}\n\`\`\``;
    const results = [
      {
        shard: 1,
        run: 1,
        agent: "review-code",
        files: ["a.ts"],
        exitCode: 0,
        output: out([
          { severity: "warning", message: "both", file: "a.ts", line: 2 },
          { severity: "suggestion", message: "once", file: "a.ts", line: 30 },
        ]),
      },
      {
        shard: 1,
        run: 2,
        agent: "review-code",
        files: ["a.ts"],
        exitCode: 0,
        output: out([{ severity: "warning", message: "both again", file: "a.ts", line: 3 }]),
      },
    ];
    const report = synthesizePrReviewReport(results, { base: "b", skipped: [], shards: 1 });
    expect(report.formatted).toContain("2 runs: 1 of 2 location(s) were reported in every run");
    const diff =
      "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,3 +1,4 @@\n a\n+b\n c\n+d\n";
    const { payload } = buildPendingReviewPayload({
      headSha: "s",
      summary: "S",
      findings: report.findings,
      files: [{ path: "a.ts", diff, bytes: diff.length }],
      totalRuns: 2,
    });
    expect(payload.comments[0]?.body).toContain("Reported in 2 of 2 runs");
  });
});

describe("models per run", () => {
  const pr = { number: 7, title: "T", baseRefName: "base", headRefOid: "sha" };
  const plan = planPrShards([mkFile("a/x.ts", 5_000)]);
  const base = {
    pr,
    plan,
    shardPaths: ["/tmp/shard-1.diff"],
    manifestPath: "/tmp/m.md",
    worktree: "/wt",
    wave: "main" as const,
  };

  test("models give one model per run, set the run count, and override runs", () => {
    const tasks = buildPrReviewTasks({ ...base, models: ["sonnet", "opus"], runs: 3 });
    expect(tasks).toHaveLength(4); // 2 agents x 2 runs
    expect(tasks.filter((t) => t.run === 1).every((t) => t.model === "sonnet")).toBe(true);
    expect(tasks.filter((t) => t.run === 2).every((t) => t.model === "opus")).toBe(true);
  });

  test("at most 3 models, blanks ignored, none means no model on the task", () => {
    expect(buildPrReviewTasks({ ...base, models: ["a", "b", "c", "d"] })).toHaveLength(6);
    expect(buildPrReviewTasks({ ...base, models: ["", "a"] }).every((t) => t.model === "a")).toBe(
      true,
    );
    expect(buildPrReviewTasks(base).every((t) => t.model === undefined)).toBe(true);
  });

  const f = (model: string, severity: string, line = 5) => ({
    run: 1,
    model,
    agent: "review-code",
    severity,
    message: "m",
    file: "a.ts",
    line,
  });

  test("findings record the models that reported them", () => {
    const out = mergeFindingsByLocation([f("opus", "warning"), f("sonnet", "warning")]);
    expect(out[0]?.models).toEqual(["opus", "sonnet"]);
  });

  test("a critical from one non-Claude model alone is capped, but only when two models ran", () => {
    const lone = mergeFindingsByLocation([f("gpt-5.6-sol", "critical")]);
    const capped = capUntrustedSeverity(lone, 2);
    expect(capped[0]).toMatchObject({ severity: "warning", cappedFrom: "critical" });
    expect(capped[0]?.message).toContain("gpt-5.6-sol alone");
    expect(capUntrustedSeverity(lone, 1)[0]?.severity).toBe("critical"); // single-model review: untouched
  });

  test("a critical is kept when a Claude model, or a second model, also reports it", () => {
    expect(
      capUntrustedSeverity(mergeFindingsByLocation([f("claude-sonnet-5.5", "critical")]), 2)[0]
        ?.severity,
    ).toBe("critical");
    expect(
      capUntrustedSeverity(
        mergeFindingsByLocation([f("gpt-5.6-sol", "critical"), f("gemini", "critical")]),
        3,
      )[0]?.severity,
    ).toBe("critical");
    expect(
      capUntrustedSeverity(mergeFindingsByLocation([f("gpt-5.6-sol", "warning")]), 2)[0]?.severity,
    ).toBe("warning");
  });

  test("the report names the models and counts what it capped; a comment names the models", () => {
    const out = (sev: string) =>
      `x\n\`\`\`json\n${JSON.stringify({ verdict: "issues", findings: [{ severity: sev, message: "m", file: "a.ts", line: 2 }], files_reviewed: ["a.ts"] })}\n\`\`\``;
    const results = [
      {
        shard: 1,
        run: 1,
        model: "claude-opus-5.5",
        agent: "review-code",
        files: ["a.ts"],
        exitCode: 0,
        output: out("warning"),
      },
      {
        shard: 1,
        run: 2,
        model: "gpt-5.6-sol",
        agent: "review-security",
        files: ["a.ts"],
        exitCode: 0,
        output: out("critical"),
      },
    ];
    const report = synthesizePrReviewReport(results, { base: "b", skipped: [], shards: 1 });
    expect(report.formatted).toContain("Models: claude-opus-5.5, gpt-5.6-sol.");
    const diff =
      "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1,3 +1,4 @@\n a\n+b\n c\n+d\n";
    const { payload } = buildPendingReviewPayload({
      headSha: "s",
      summary: "S",
      findings: report.findings,
      files: [{ path: "a.ts", diff, bytes: diff.length }],
      totalRuns: 2,
    });
    expect(payload.comments[0]?.body).toContain("claude-opus-5.5, gpt-5.6-sol");
  });
});
