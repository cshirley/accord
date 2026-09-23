import { describe, expect, test } from "bun:test";
import { execFile as execFileCb } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  buildStandaloneReviewTasks,
  excerptStandaloneReviewDiff,
  gatherStandaloneReviewDiff,
  isStandaloneReviewTestFile,
  parseStandaloneReviewAgentResult,
  prepareStandaloneReviewContext,
  resolveStandaloneReviewSourceAlias,
  resolveStandaloneReviewTestCommand,
  STANDALONE_REVIEW_MAX_DIFF_BYTES,
  synthesizeStandaloneReviewReport,
  writeStandaloneReviewDiffFile,
} from "../src/review/standalone.js";

const execFile = promisify(execFileCb);

/** Monorepo root — tests must not rely on `process.cwd()` (other suites chdir). */
const repoRoot = join(import.meta.dirname, "..", "..", "..");

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFile("git", args, { cwd });
}

async function runGitCapture(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFile("git", args, { cwd });
  return stdout;
}

async function ensureOriginHeadSymref(repoDir: string): Promise<void> {
  await runGit(repoDir, ["fetch", "origin"]);
  await runGit(repoDir, ["remote", "set-head", "origin", "-a"]);
}

async function createBareTestRepo(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "accord-review-git-"));
  await runGit(dir, ["init", "-b", "main"]);
  await runGit(dir, ["config", "user.email", "test@example.com"]);
  await runGit(dir, ["config", "user.name", "Accord Test"]);
  return {
    dir,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

describe("standalone review", () => {
  test("isStandaloneReviewTestFile matches core regex", () => {
    expect(isStandaloneReviewTestFile("src/foo.test.ts")).toBe(true);
    expect(isStandaloneReviewTestFile("pkg/__tests__/bar.ts")).toBe(true);
    expect(isStandaloneReviewTestFile("src/foo.ts")).toBe(false);
  });

  test("resolveStandaloneReviewTestCommand prefers harness test.command", async () => {
    const customPkgDir = await mkdtemp(join(tmpdir(), "accord-review-pkg-"));
    try {
      await writeFile(
        join(customPkgDir, "package.json"),
        JSON.stringify({ scripts: { test: "node --test" } }),
        "utf8",
      );
      await expect(
        resolveStandaloneReviewTestCommand(customPkgDir, { test: { command: "bun test custom" } }),
      ).resolves.toBe("bun test custom");
      await expect(
        resolveStandaloneReviewTestCommand(customPkgDir, { test: { command: "  " } }),
      ).resolves.toBe("node --test");
      await expect(resolveStandaloneReviewTestCommand(customPkgDir, null)).resolves.toBe(
        "node --test",
      );
    } finally {
      await rm(customPkgDir, { recursive: true, force: true });
    }
    const noScriptDir = await mkdtemp(join(tmpdir(), "accord-review-noscript-"));
    try {
      await writeFile(join(noScriptDir, "package.json"), JSON.stringify({ scripts: {} }), "utf8");
      await expect(resolveStandaloneReviewTestCommand(noScriptDir, null)).resolves.toBeNull();
    } finally {
      await rm(noScriptDir, { recursive: true, force: true });
    }
  });

  test("buildStandaloneReviewTasks always references diff_path", () => {
    const diffPath = "/tmp/accord-review-abc/diff.patch";
    const tasks = buildStandaloneReviewTasks({
      diff_path: diffPath,
      source: "local",
      file_list: ["a.ts"],
      local_layers: ["staged", "unstaged"],
    });
    expect(tasks.map((task) => task.agent)).toEqual(["review-code", "review-security"]);
    expect(tasks[0].task).toContain(diffPath);
    expect(tasks[0].task).toContain("normalized_source: local");
    expect(tasks[0].task).toContain("local_layers: staged+unstaged");
    expect(tasks[0].task).toContain("Existing patterns / local consistency");
    expect(tasks[0].task).not.toContain("Diff:\n\n");
  });

  test("writeStandaloneReviewDiffFile writes full raw diff", async () => {
    const { diff_path, temp_dir, cleanup } = await writeStandaloneReviewDiffFile("diff body");
    const onDisk = await readFile(diff_path, "utf8");
    expect(onDisk).toBe("diff body");
    await cleanup();
    await expect(readFile(diff_path, "utf8")).rejects.toThrow();
    await rm(temp_dir, { recursive: true, force: true }).catch(() => {});
  });

  test("prepareStandaloneReviewContext returns temp diff path", async () => {
    const result = await prepareStandaloneReviewContext(process.cwd());
    if (!result.ok) {
      expect(result.error).toContain("No diff found");
      return;
    }
    expect(result.value.diff_path).toContain("diff.patch");
    await result.value.cleanup();
  });

  test("parseStandaloneReviewAgentResult maps issue to message", () => {
    const result = parseStandaloneReviewAgentResult("review-code", {
      exitCode: 0,
      parsedReturn: {
        verdict: "issues",
        findings: [{ severity: "warning", issue: "unused var", file: "x.ts", line: 3 }],
      },
    });
    expect(result.findings[0]?.message).toBe("unused var");
    expect(result.findings[0]?.file).toBe("x.ts");
    expect(result.findings[0]?.line).toBe(3);
  });

  test("synthesizeStandaloneReviewReport formats file:line and omits test section when absent", () => {
    const report = synthesizeStandaloneReviewReport([
      {
        agent: "review-code",
        exit_code: 0,
        findings: [
          {
            severity: "warning",
            message: "nit",
            agent: "review-code",
            file: "src/a.ts",
            line: 10,
          },
        ],
      },
      { agent: "review-security", exit_code: 0, findings: [] },
    ]);
    expect(report.formatted).toContain("`src/a.ts:10`");
    expect(report.formatted).not.toContain("### Test Quality");
    expect(report.counts.quality).toBe(1);
  });

  test("synthesizeStandaloneReviewReport includes agent failures", () => {
    const report = synthesizeStandaloneReviewReport([
      {
        agent: "review-code",
        exit_code: 1,
        findings: [],
        error: "spawn failed",
      },
    ]);
    expect(report.formatted).toContain("### Agent failures");
    expect(report.formatted).toContain("review-code");
  });

  test("truncateStandaloneTestOutput caps test output", async () => {
    const { truncateStandaloneTestOutput } = await import("../src/review/standalone.js");
    const long = "x".repeat(70 * 1024);
    expect(Buffer.byteLength(truncateStandaloneTestOutput(long), "utf8")).toBeLessThanOrEqual(
      64 * 1024 + 32,
    );
  });

  test("excerptStandaloneReviewDiff caps excerpt bytes", () => {
    const long = "x".repeat(600 * 1024);
    expect(Buffer.byteLength(excerptStandaloneReviewDiff(long), "utf8")).toBeLessThanOrEqual(
      STANDALONE_REVIEW_MAX_DIFF_BYTES + 32,
    );
  });

  test("prepareStandaloneReviewContext preserves local_layers from gather", async () => {
    const repo = await createBareTestRepo();
    try {
      await writeFile(join(repo.dir, "tracked.txt"), "v1\n", "utf8");
      await runGit(repo.dir, ["add", "tracked.txt"]);
      await runGit(repo.dir, ["commit", "-m", "init"]);
      await writeFile(join(repo.dir, "tracked.txt"), "v2\n", "utf8");
      await runGit(repo.dir, ["add", "tracked.txt"]);
      await writeFile(join(repo.dir, "tracked.txt"), "v1\n", "utf8");

      const result = await prepareStandaloneReviewContext(repo.dir);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.normalized_source).toBe("local");
      expect(result.value.source).toBe("local");
      expect(result.value.local_layers).toEqual(["staged", "unstaged"]);
      expect(result.value.raw_diff).toContain("## ACCORD review: staged");
      await result.value.cleanup();
    } finally {
      await repo.cleanup();
    }
  });

  test("prepareStandaloneReviewContext preserves unstaged-only local_layers", async () => {
    const repo = await createBareTestRepo();
    try {
      await writeFile(join(repo.dir, "tracked.txt"), "v1\n", "utf8");
      await runGit(repo.dir, ["add", "tracked.txt"]);
      await runGit(repo.dir, ["commit", "-m", "init"]);
      await writeFile(join(repo.dir, "tracked.txt"), "v2\n", "utf8");

      const result = await prepareStandaloneReviewContext(repo.dir);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.source).toBe("unstaged");
      expect(result.value.local_layers).toEqual(["unstaged"]);
      await result.value.cleanup();
    } finally {
      await repo.cleanup();
    }
  });

  test("prepareStandaloneReviewContext preserves mixed local_layers", async () => {
    const repo = await createBareTestRepo();
    try {
      await writeFile(join(repo.dir, "tracked.txt"), "v1\n", "utf8");
      await runGit(repo.dir, ["add", "tracked.txt"]);
      await runGit(repo.dir, ["commit", "-m", "init"]);
      await writeFile(join(repo.dir, "wt-only.txt"), "base\n", "utf8");
      await runGit(repo.dir, ["add", "wt-only.txt"]);
      await runGit(repo.dir, ["commit", "-m", "add wt-only"]);
      await writeFile(join(repo.dir, "staged-only.txt"), "staged\n", "utf8");
      await runGit(repo.dir, ["add", "staged-only.txt"]);
      await writeFile(join(repo.dir, "wt-only.txt"), "changed\n", "utf8");

      const result = await prepareStandaloneReviewContext(repo.dir);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.source).toBe("local");
      expect(result.value.local_layers).toEqual(["staged", "unstaged"]);
      await result.value.cleanup();
    } finally {
      await repo.cleanup();
    }
  });

  test("exports diff byte cap constant", () => {
    expect(STANDALONE_REVIEW_MAX_DIFF_BYTES).toBe(512 * 1024);
  });

  test("gatherStandaloneReviewDiff uses local for unborn HEAD with staged files", async () => {
    const repo = await createBareTestRepo();
    try {
      await writeFile(join(repo.dir, "first.txt"), "hello\n", "utf8");
      await runGit(repo.dir, ["add", "first.txt"]);

      const result = await gatherStandaloneReviewDiff(repo.dir);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.normalized_source).toBe("local");
      expect(result.value.source).toBe("staged");
      expect(result.value.file_list).toEqual(["first.txt"]);
      expect(result.value.raw_diff).toContain("diff --git a/first.txt b/first.txt");
      expect(result.value.raw_diff).toContain("+hello");
    } finally {
      await repo.cleanup();
    }
  });

  test("resolveStandaloneReviewSourceAlias maps single local layer to legacy source", () => {
    expect(resolveStandaloneReviewSourceAlias("local", ["staged"])).toBe("staged");
    expect(resolveStandaloneReviewSourceAlias("local", ["unstaged"])).toBe("unstaged");
    expect(resolveStandaloneReviewSourceAlias("local", ["staged", "unstaged"])).toBe("local");
    expect(resolveStandaloneReviewSourceAlias("branch")).toBe("branch");
  });

  test("gatherStandaloneReviewDiff merges staged and unstaged when both differ from HEAD", async () => {
    const repo = await createBareTestRepo();
    try {
      await writeFile(join(repo.dir, "tracked.txt"), "v1\n", "utf8");
      await runGit(repo.dir, ["add", "tracked.txt"]);
      await runGit(repo.dir, ["commit", "-m", "init"]);
      await writeFile(join(repo.dir, "wt-only.txt"), "base\n", "utf8");
      await runGit(repo.dir, ["add", "wt-only.txt"]);
      await runGit(repo.dir, ["commit", "-m", "add wt-only"]);
      await writeFile(join(repo.dir, "staged-only.txt"), "staged\n", "utf8");
      await runGit(repo.dir, ["add", "staged-only.txt"]);
      await writeFile(join(repo.dir, "wt-only.txt"), "changed\n", "utf8");

      const result = await gatherStandaloneReviewDiff(repo.dir);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.normalized_source).toBe("local");
      expect(result.value.source).toBe("local");
      expect(result.value.local_layers).toEqual(["staged", "unstaged"]);
      expect(result.value.file_list.sort()).toEqual(["staged-only.txt", "wt-only.txt"]);
      expect(result.value.raw_diff).toContain("diff --git a/staged-only.txt");
      expect(result.value.raw_diff).toContain("+staged");
      expect(result.value.raw_diff).toContain("diff --git a/wt-only.txt");
      expect(result.value.raw_diff).toContain("+changed");
    } finally {
      await repo.cleanup();
    }
  });

  test("gatherStandaloneReviewDiff includes staged hunks when worktree matches HEAD", async () => {
    const repo = await createBareTestRepo();
    try {
      await writeFile(join(repo.dir, "tracked.txt"), "v1\n", "utf8");
      await runGit(repo.dir, ["add", "tracked.txt"]);
      await runGit(repo.dir, ["commit", "-m", "init"]);
      await writeFile(join(repo.dir, "tracked.txt"), "v2\n", "utf8");
      await runGit(repo.dir, ["add", "tracked.txt"]);
      await writeFile(join(repo.dir, "tracked.txt"), "v1\n", "utf8");

      const headOnly = await runGitCapture(repo.dir, ["diff", "HEAD"]);
      expect(headOnly.trim()).toBe("");

      const result = await gatherStandaloneReviewDiff(repo.dir);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.normalized_source).toBe("local");
      expect(result.value.source).toBe("local");
      expect(result.value.local_layers).toEqual(["staged", "unstaged"]);
      expect(result.value.raw_diff).toContain("## ACCORD review: staged");
      expect(result.value.raw_diff).toContain("+v2");
    } finally {
      await repo.cleanup();
    }
  });

  test("gatherStandaloneReviewDiff prefers local over branch when working tree is dirty", async () => {
    const repo = await createBareTestRepo();
    const bareDir = await mkdtemp(join(tmpdir(), "accord-review-bare-"));
    try {
      await runGit(bareDir, ["init", "--bare", "-b", "main"]);
      await writeFile(join(repo.dir, "tracked.txt"), "v1\n", "utf8");
      await runGit(repo.dir, ["add", "tracked.txt"]);
      await runGit(repo.dir, ["commit", "-m", "init"]);
      await runGit(repo.dir, ["remote", "add", "origin", bareDir]);
      await runGit(repo.dir, ["push", "-u", "origin", "main"]);
      await ensureOriginHeadSymref(repo.dir);

      await writeFile(join(repo.dir, "tracked.txt"), "v2\n", "utf8");
      await runGit(repo.dir, ["add", "tracked.txt"]);
      await runGit(repo.dir, ["commit", "-m", "ahead-of-origin"]);
      await writeFile(join(repo.dir, "tracked.txt"), "v2\nlocal edit\n", "utf8");

      const result = await gatherStandaloneReviewDiff(repo.dir);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.normalized_source).toBe("local");
      expect(result.value.source).toBe("unstaged");
      expect(result.value.file_list).toEqual(["tracked.txt"]);
      expect(result.value.raw_diff).toContain("diff --git a/tracked.txt b/tracked.txt");
      expect(result.value.raw_diff).toContain("+local edit");
      expect(result.value.raw_diff).not.toContain("-v1\n");
    } finally {
      await repo.cleanup();
      await rm(bareDir, { recursive: true, force: true });
    }
  });

  test("gatherStandaloneReviewDiff uses branch when tree is clean and ahead of origin", async () => {
    const repo = await createBareTestRepo();
    const bareDir = await mkdtemp(join(tmpdir(), "accord-review-bare-"));
    try {
      await runGit(bareDir, ["init", "--bare", "-b", "main"]);
      await writeFile(join(repo.dir, "tracked.txt"), "v1\n", "utf8");
      await runGit(repo.dir, ["add", "tracked.txt"]);
      await runGit(repo.dir, ["commit", "-m", "init"]);
      await runGit(repo.dir, ["remote", "add", "origin", bareDir]);
      await runGit(repo.dir, ["push", "-u", "origin", "main"]);
      await ensureOriginHeadSymref(repo.dir);

      await writeFile(join(repo.dir, "tracked.txt"), "v2\n", "utf8");
      await runGit(repo.dir, ["add", "tracked.txt"]);
      await runGit(repo.dir, ["commit", "-m", "second"]);

      const result = await gatherStandaloneReviewDiff(repo.dir);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.normalized_source).toBe("branch");
      expect(result.value.source).toBe("branch");
      expect(result.value.file_list).toEqual(["tracked.txt"]);
      expect(result.value.raw_diff).toContain("diff --git a/tracked.txt b/tracked.txt");
      expect(result.value.raw_diff).toContain("+v2");
    } finally {
      await repo.cleanup();
      await rm(bareDir, { recursive: true, force: true });
    }
  });
});
