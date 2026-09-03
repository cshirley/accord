import { describe, expect, test } from "bun:test";
import { parseHarnessIdValue } from "@clive.shirley/accord-core/config/harness-default.js";
import {
  buildStandaloneReviewTasks,
  isStandaloneReviewTestFile,
  synthesizeStandaloneReviewReport,
} from "@clive.shirley/accord-core/review/standalone.js";
import { parseCli } from "../src/cli.js";
import { parseHarnessId } from "../src/harnesses/registry.js";

describe("accord-cli argv", () => {
  test("parse help command", () => {
    const parsed = parseCli(["help", "--json"]);
    expect(parsed.kind).toBe("dev-help");
    if (parsed.kind !== "dev-help") return;
    expect(parsed.options.json).toBe(true);
  });

  test("parse deviations list", () => {
    const parsed = parseCli(["deviations", "DEMO-1"]);
    expect(parsed.kind).toBe("deviations");
    if (parsed.kind !== "deviations") return;
    expect(parsed.workItemId).toBe("DEMO-1");
    expect(parsed.rawArgs).toBe("");
  });

  test("parse deviations review with task id", () => {
    const parsed = parseCli(["deviations", "DEMO-1", "review", "3", "--harness=exec"]);
    expect(parsed.kind).toBe("deviations");
    if (parsed.kind !== "deviations") return;
    expect(parsed.workItemId).toBe("DEMO-1");
    expect(parsed.rawArgs).toBe("review 3");
    expect(parsed.options.harness).toBe("exec");
  });

  test("parse resume with harness flag", () => {
    const parsed = parseCli(["resume", "DEMO-1", "--harness=pi", "--cwd=/tmp/proj", "-y"]);
    expect(parsed.kind).toBe("resume");
    if (parsed.kind !== "resume") return;
    expect(parsed.workItemId).toBe("DEMO-1");
    expect(parsed.options.harness).toBe("pi");
    expect(parsed.options.cwd).toBe("/tmp/proj");
    expect(parsed.options.yes).toBe(true);
  });

  test("parse retro", () => {
    const parsed = parseCli(["retro", "--json"]);
    expect(parsed.kind).toBe("retro");
    if (parsed.kind !== "retro") return;
    expect(parsed.options.json).toBe(true);
  });

  test("parse tag", () => {
    const parsed = parseCli(["tag", "sprint-42"]);
    expect(parsed.kind).toBe("tag");
    if (parsed.kind !== "tag") return;
    expect(parsed.rawArgs).toBe("sprint-42");
  });

  test("parse rehydrate", () => {
    const parsed = parseCli(["rehydrate", "DEMO-1"]);
    expect(parsed.kind).toBe("rehydrate");
    if (parsed.kind !== "rehydrate") return;
    expect(parsed.workItemId).toBe("DEMO-1");
  });

  test("parse spec-gaps", () => {
    const parsed = parseCli(["spec-gaps", "ACCORD-12"]);
    expect(parsed.kind).toBe("spec-gaps");
    if (parsed.kind !== "spec-gaps") return;
    expect(parsed.workItemId).toBe("ACCORD-12");
  });

  test("parse gaps with tickets flag", () => {
    const parsed = parseCli(["gaps", "DEMO-1", "--tickets", "--harness=exec"]);
    expect(parsed.kind).toBe("gaps");
    if (parsed.kind !== "gaps") return;
    expect(parsed.workItemId).toBe("DEMO-1");
    expect(parsed.rawArgs).toBe("--tickets");
    expect(parsed.options.harness).toBe("exec");
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
    expect(() => parseHarnessIdValue("cursor")).toThrow(/Unknown harness/);
  });

  test("parseHarnessId accepts explicit harness", () => {
    expect(parseHarnessId("exec")).toBe("exec");
  });

  test("global --help returns help kind", () => {
    expect(parseCli(["--help"]).kind).toBe("help");
  });

  test("bare argv on TTY returns interactive mode", () => {
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    try {
      expect(parseCli([]).kind).toBe("interactive");
    } finally {
      Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, configurable: true });
    }
  });

  test("completion without shell is an error", () => {
    const parsed = parseCli(["completion"]);
    expect(parsed.kind).toBe("error");
    if (parsed.kind !== "error") return;
    expect(parsed.message).toContain("completion requires a shell");
  });

  test("config init rejects unknown flags", () => {
    const parsed = parseCli(["config", "init", "--bogus"]);
    expect(parsed.kind).toBe("error");
    if (parsed.kind !== "error") return;
    expect(parsed.message).toContain("Unknown config init flag");
  });

  test("rehydrate requires a work item id", () => {
    const parsed = parseCli(["rehydrate"]);
    expect(parsed.kind).toBe("error");
    if (parsed.kind !== "error") return;
    expect(parsed.message).toContain("rehydrate requires a work item id");
  });

  test("spec-gaps requires a work item id", () => {
    const parsed = parseCli(["spec-gaps"]);
    expect(parsed.kind).toBe("error");
    if (parsed.kind !== "error") return;
    expect(parsed.message).toContain("spec-gaps requires a work item id");
  });

  test("gaps requires a work item id", () => {
    const parsed = parseCli(["gaps"]);
    expect(parsed.kind).toBe("error");
    if (parsed.kind !== "error") return;
    expect(parsed.message).toContain("gaps requires a work item id");
  });

  test("deviations requires a work item id", () => {
    const parsed = parseCli(["deviations"]);
    expect(parsed.kind).toBe("error");
    if (parsed.kind !== "error") return;
    expect(parsed.message).toContain("deviations requires a work item id");
  });

  test("drive requires a work item id", () => {
    const parsed = parseCli(["drive"]);
    expect(parsed.kind).toBe("error");
    if (parsed.kind !== "error") return;
    expect(parsed.message).toContain("drive requires a work item id");
  });

  test("run requires ticket text", () => {
    const parsed = parseCli(["run"]);
    expect(parsed.kind).toBe("error");
    if (parsed.kind !== "error") return;
    expect(parsed.message).toContain("run requires a ticket id or description");
  });

  test("invalid --max-rounds is an error", () => {
    const parsed = parseCli(["drive", "DEMO-1", "--max-rounds=0"]);
    expect(parsed.kind).toBe("error");
    if (parsed.kind !== "error") return;
    expect(parsed.message).toContain("--max-rounds requires a positive integer");
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
