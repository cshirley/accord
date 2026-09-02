import { describe, expect, test } from "bun:test";
import {
  buildStandaloneReviewTasks,
  isStandaloneReviewTestFile,
  synthesizeStandaloneReviewReport,
} from "@clive.shirley/accord-core/review/standalone.js";
import { parseCli } from "../src/cli.js";
import { parseHarnessId } from "../src/harnesses/registry.js";

describe("accord-cli argv", () => {
  test("parse resume with harness flag", () => {
    const parsed = parseCli(["resume", "DEMO-1", "--harness=pi", "--cwd=/tmp/proj", "-y"]);
    expect(parsed.kind).toBe("resume");
    if (parsed.kind !== "resume") return;
    expect(parsed.workItemId).toBe("DEMO-1");
    expect(parsed.options.harness).toBe("pi");
    expect(parsed.options.cwd).toBe("/tmp/proj");
    expect(parsed.options.yes).toBe(true);
  });

  test("parse plan finish", () => {
    const parsed = parseCli(["plan", "finish", "WI-9", "--json"]);
    expect(parsed.kind).toBe("plan");
    if (parsed.kind !== "plan") return;
    expect(parsed.command).toBe("finish");
    expect(parsed.workItemId).toBe("WI-9");
    expect(parsed.options.json).toBe(true);
  });

  test("parse workflow plan subcommand", () => {
    const parsed = parseCli(["plan", "ACCORD-12", "--harness=pi"]);
    expect(parsed.kind).toBe("workflow");
    if (parsed.kind !== "workflow") return;
    expect(parsed.subcommand).toBe("plan");
    expect(parsed.workItemId).toBe("ACCORD-12");
  });

  test("parse align workflow", () => {
    const parsed = parseCli(["align", "DEMO-2"]);
    expect(parsed.kind).toBe("workflow");
    if (parsed.kind !== "workflow") return;
    expect(parsed.subcommand).toBe("align");
    expect(parsed.workItemId).toBe("DEMO-2");
  });

  test("parse init write target", () => {
    const parsed = parseCli(["init", "--write", "--target=local", "--json"]);
    expect(parsed.kind).toBe("init");
    if (parsed.kind !== "init") return;
    expect(parsed.options.write).toBe(true);
    expect(parsed.options.target).toBe("local");
    expect(parsed.options.json).toBe(true);
  });

  test("parse review", () => {
    const parsed = parseCli(["review", "--json"]);
    expect(parsed.kind).toBe("review");
    if (parsed.kind !== "review") return;
    expect(parsed.options.json).toBe(true);
  });

  test("reject unknown harness", () => {
    expect(() => parseHarnessId("cursor")).toThrow(/Unknown harness/);
  });
});

describe("standalone review helpers", () => {
  test("detects test files and builds review-test task", () => {
    expect(isStandaloneReviewTestFile("src/foo.test.ts")).toBe(true);
    expect(isStandaloneReviewTestFile("src/foo.ts")).toBe(false);

    const tasks = buildStandaloneReviewTasks({
      diff: "diff",
      file_list: ["src/foo.test.ts"],
      test_output: "ok",
    });
    expect(tasks.map((task) => task.agent)).toEqual([
      "review-code",
      "review-security",
      "review-test",
    ]);
  });

  test("synthesizes merged report", () => {
    const report = synthesizeStandaloneReviewReport([
      {
        agent: "review-code",
        exit_code: 0,
        findings: [{ severity: "warning", message: "nit", agent: "review-code" }],
      },
      {
        agent: "review-security",
        exit_code: 0,
        findings: [],
      },
    ]);
    expect(report.formatted).toContain("## Review");
    expect(report.counts.quality).toBe(1);
  });
});
