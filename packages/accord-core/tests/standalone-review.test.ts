import { describe, expect, test } from "bun:test";
import { readFile, rm } from "node:fs/promises";
import {
  buildStandaloneReviewTasks,
  excerptStandaloneReviewDiff,
  isStandaloneReviewTestFile,
  parseStandaloneReviewAgentResult,
  prepareStandaloneReviewContext,
  resolveStandaloneReviewTestCommand,
  STANDALONE_REVIEW_MAX_DIFF_BYTES,
  synthesizeStandaloneReviewReport,
  writeStandaloneReviewDiffFile,
} from "../src/review/standalone.js";

describe("standalone review", () => {
  test("isStandaloneReviewTestFile matches core regex", () => {
    expect(isStandaloneReviewTestFile("src/foo.test.ts")).toBe(true);
    expect(isStandaloneReviewTestFile("pkg/__tests__/bar.ts")).toBe(true);
    expect(isStandaloneReviewTestFile("src/foo.ts")).toBe(false);
  });

  test("resolveStandaloneReviewTestCommand prefers harness test.command", async () => {
    await expect(
      resolveStandaloneReviewTestCommand(process.cwd(), { test: { command: "bun test" } }),
    ).resolves.toBe("bun test");
    await expect(
      resolveStandaloneReviewTestCommand(process.cwd(), { test: { command: "  " } }),
    ).resolves.toBe("bun test");
    await expect(resolveStandaloneReviewTestCommand(process.cwd(), null)).resolves.toBe("bun test");
  });

  test("buildStandaloneReviewTasks always references diff_path", () => {
    const diffPath = "/tmp/accord-review-abc/diff.patch";
    const tasks = buildStandaloneReviewTasks({
      diff_path: diffPath,
      source: "staged",
      file_list: ["a.ts"],
    });
    expect(tasks[0].task).toContain(diffPath);
    expect(tasks[0].task).toContain("source: staged");
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

  test("exports diff byte cap constant", () => {
    expect(STANDALONE_REVIEW_MAX_DIFF_BYTES).toBe(512 * 1024);
  });
});
