import { describe, expect, test } from "bun:test";
import { matchCommands, matchWorkItems } from "../src/ui/command-catalog.js";
import { renderCompletionScript } from "../src/ui/completion.js";
import { renderHelp } from "../src/ui/help-display.js";
import { classifyTasksDashboardLine } from "../src/ui/tasks-display.js";
import { parseCli } from "../src/cli.js";

describe("accord-cli UI", () => {
  test("renderHelp includes completion hint", () => {
    const help = renderHelp();
    expect(help).toContain("completion");
    expect(help).toContain("interactive shell");
  });

  test("matchCommands filters by prefix", () => {
    const matches = matchCommands("ta");
    expect(matches).toContain("tag");
    expect(matches).toContain("tasks");
    expect(matches).not.toContain("run");
  });

  test("matchWorkItems filters ids", () => {
    const matches = matchWorkItems("acc", ["ACCORD-1", "DEMO-2"]);
    expect(matches).toEqual(["ACCORD-1"]);
  });

  test("classifyTasksDashboardLine detects sections", () => {
    expect(classifyTasksDashboardLine("Active")).toBe("section");
    expect(classifyTasksDashboardLine("ACCORD-1  align  2/5")).toBe("row");
  });

  test("renderCompletionScript bash", () => {
    const script = renderCompletionScript("bash");
    expect(script).toContain("_accord_completion");
    expect(script).toContain("complete -F _accord_completion accord");
  });

  test("parse completion command", () => {
    const parsed = parseCli(["completion", "zsh"]);
    expect(parsed.kind).toBe("completion");
    if (parsed.kind !== "completion") return;
    expect(parsed.shell).toBe("zsh");
  });

  test("parse --select flag", () => {
    const parsed = parseCli(["tasks", "--select"]);
    expect(parsed.kind).toBe("tasks");
    if (parsed.kind !== "tasks") return;
    expect(parsed.options.select).toBe(true);
  });

  test("parse --no-color flag", () => {
    const parsed = parseCli(["help", "--no-color"]);
    expect(parsed.kind).toBe("dev-help");
    if (parsed.kind !== "dev-help") return;
    expect(parsed.options.noColor).toBe(true);
  });
});
