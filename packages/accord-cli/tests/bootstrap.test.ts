import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseCli } from "../src/cli.js";
import { parseBootstrapArgs, runBootstrapCommand } from "../src/commands/bootstrap.js";
import { executeParsed } from "../src/dispatch.js";

let tempCwd: string;
let originalCwd: string;
let logged: string[];
let errors: string[];
const realLog = console.log;
const realError = console.error;

beforeEach(() => {
  setSystemTime(new Date(2026, 0, 5, 12, 0, 0));
  originalCwd = process.cwd();
  tempCwd = mkdtempSync(join(tmpdir(), "accord-bootstrap-"));
  // A git root stops loadWorkItem's walk-up over ancestor `.tasks` directories.
  Bun.spawnSync(["git", "init", "-q"], { cwd: tempCwd });
  process.chdir(tempCwd);
  mkdirSync(".tasks", { recursive: true });
  logged = [];
  errors = [];
  console.log = (...args: unknown[]) => void logged.push(args.join(" "));
  console.error = (...args: unknown[]) => void errors.push(args.join(" "));
});

afterEach(() => {
  console.log = realLog;
  console.error = realError;
  process.chdir(originalCwd);
  rmSync(tempCwd, { recursive: true, force: true });
  setSystemTime();
});

function run(tail: string[], json = false): number {
  const parsed = parseBootstrapArgs(tail);
  if (!parsed.ok) throw new Error(parsed.message);
  return runBootstrapCommand(parsed.args, { json });
}

const workItem = (id: string) =>
  JSON.parse(readFileSync(join(".tasks", `${id}.json`), "utf8")) as Record<string, unknown>;

describe("accord bootstrap", () => {
  test("creates a work item from id and title with a real title", () => {
    expect(run(["STEP-7", "add", "token", "refresh"])).toBe(0);
    const wi = workItem("STEP-7");
    expect(wi.title).toBe("add token refresh");
    expect(wi.pattern).toBe("implement");
    expect(wi.variant).toBe("standard");
    expect(wi.phase).toBe("aligning");
    expect(logged.join("\n")).toContain("Next: accord align STEP-7");
  });

  test("--pattern and --variant are persisted", () => {
    expect(run(["STEP-9", "t", "--pattern", "quick_fix", "--variant", "express"])).toBe(0);
    const wi = workItem("STEP-9");
    expect(wi.pattern).toBe("quick_fix");
    expect(wi.variant).toBe("express");
    expect(wi.expected_finish).toBe("t");
  });

  test("--adhoc generates exact ADHOC ids from the local date and increments", () => {
    expect(run(["--adhoc", "first", "thing"], true)).toBe(0);
    expect(run(["--adhoc", "second", "thing"], true)).toBe(0);
    const ids = logged.map((line) => (JSON.parse(line) as { id: string }).id);
    expect(ids).toEqual(["ADHOC-2026010501", "ADHOC-2026010502"]);
    expect(existsSync(join(".tasks", "ADHOC-2026010501.json"))).toBe(true);
  });

  test("--adhoc skips an id that already has docs/dev/<ID>", () => {
    mkdirSync(join("docs", "dev", "ADHOC-2026010501"), { recursive: true });
    expect(run(["--adhoc", "y"], true)).toBe(0);
    expect((JSON.parse(logged[0]) as { id: string }).id).toBe("ADHOC-2026010502");
  });

  test("JSON output carries id, next and path", () => {
    expect(run(["--adhoc", "x"], true)).toBe(0);
    expect(JSON.parse(logged[0])).toMatchObject({
      id: "ADHOC-2026010501",
      title: "x",
      pattern: "implement",
      next: "accord align ADHOC-2026010501",
    });
    expect((JSON.parse(logged[0]) as { path: string }).path).toContain("ADHOC-2026010501.json");
  });

  test("next is resume when the work item does not start in aligning", () => {
    expect(run(["--adhoc", "fix typo", "--pattern", "quick_fix"], true)).toBe(0);
    expect((JSON.parse(logged[0]) as { next: string }).next).toBe("accord resume ADHOC-2026010501");
    logged.length = 0;
    expect(run(["--adhoc", "tiny", "--variant", "express"], true)).toBe(0);
    expect((JSON.parse(logged[0]) as { next: string }).next).toBe("accord resume ADHOC-2026010502");
  });

  test("a bare -- ends flags so a title word may start with --", () => {
    const parsed = parseBootstrapArgs(["--adhoc", "--", "handle", "--foo", "flag"]);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.args.title).toBe("handle --foo flag");
  });

  test("parseCli passes a bare -- through so the title may start with --", () => {
    const parsed = parseCli(["bootstrap", "--adhoc", "--", "--fix", "it"]);
    expect(parsed.kind).toBe("bootstrap");
    if (parsed.kind === "bootstrap") expect(parsed.args.title).toBe("--fix it");
  });

  test("after -- even global flags are title text, not options", () => {
    const parsed = parseCli(["bootstrap", "--adhoc", "--", "explain", "--json", "output", "-h"]);
    expect(parsed.kind).toBe("bootstrap");
    if (parsed.kind !== "bootstrap") return;
    expect(parsed.args.title).toBe("explain --json output -h");
    expect(parsed.options.json).toBe(false);
    expect(parsed.options.help).toBe(false);
  });

  test("global flags before -- still apply", () => {
    const parsed = parseCli(["--json", "bootstrap", "--adhoc", "--", "title"]);
    expect(parsed.kind).toBe("bootstrap");
    if (parsed.kind === "bootstrap") expect(parsed.options.json).toBe(true);
  });

  test("--adhoc with a ticket-shaped first word is rejected with guidance", () => {
    const parsed = parseBootstrapArgs(["--adhoc", "STEP-5", "add", "refresh"]);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.message).toContain("bootstrap STEP-5 <title>");
  });

  test("parser partitions: equals forms, missing values, bad enums, unknown flags mention --", () => {
    const ok = parseBootstrapArgs(["STEP-1", "t", "--pattern=quick_fix", "--variant=express"]);
    expect(ok.ok && [ok.args.pattern, ok.args.variant]).toEqual(["quick_fix", "express"]);
    const cases: Array<[string[], string]> = [
      [["STEP-1", "t", "--pattern"], "--pattern requires a value"],
      [["STEP-1", "t", "--variant"], "--variant requires a value"],
      [["STEP-1", "t", "--variant", "nope"], "--variant must be one of"],
      [["STEP-1", "t", "--pattern=nope"], "--pattern must be one of"],
      [["STEP-1", "t", "--fix"], "bare `--`"],
      [["STEP-1"], "requires <ID> <title>"],
    ];
    for (const [tail, message] of cases) {
      const parsed = parseBootstrapArgs(tail);
      expect([tail, parsed.ok]).toEqual([tail, false]);
      if (!parsed.ok) expect(parsed.message).toContain(message);
    }
  });

  test("an explicit id whose docs/dev/<ID> exists is refused", () => {
    mkdirSync(join("docs", "dev", "STEP-4"), { recursive: true });
    expect(run(["STEP-4", "x"])).toBe(1);
    expect(errors.join("\n")).toContain("already exists");
    expect(existsSync(join(".tasks", "STEP-4.json"))).toBe(false);
  });

  test("--adhoc with investigate or analyse is refused with guidance; explicit ids resume", () => {
    expect(run(["--adhoc", "why slow", "--pattern", "investigate"])).toBe(1);
    expect(errors.join("\n")).toContain("Use a real ticket id");
    errors.length = 0;
    expect(run(["STEP-20", "why slow", "--pattern", "investigate"], true)).toBe(0);
    const out = JSON.parse(logged[logged.length - 1]) as { next: string; phase: string };
    expect(out.next).toBe("accord resume STEP-20");
    expect(out.phase).toBe("gathering");
    expect(workItem("STEP-20").phase).toBe("gathering");
  });

  test("refusals change nothing", () => {
    expect(run(["STEP-8", "one"])).toBe(0);
    const before = readdirSync(".tasks");
    expect(run(["STEP-8", "two"])).toBe(1);
    expect(errors.join("\n")).toContain("already exists");
    expect(workItem("STEP-8").title).toBe("one");
    expect(run(["STEP-5", "STEP-123"])).toBe(1);
    expect(errors.join("\n")).toContain("title must describe the work");
    expect(run(["not-an-id", "title"])).toBe(1);
    expect(errors.join("\n")).toContain("is not a work item id");
    expect(readdirSync(".tasks")).toEqual(before);
  });

  test("the bootstrap command is wired through executeParsed", async () => {
    const code = await executeParsed(
      parseCli(["bootstrap", "--adhoc", "wired", "up", "--json", "--cwd", tempCwd]),
    );
    expect(code).toBe(0);
    expect((JSON.parse(logged[0]) as { id: string }).id).toBe("ADHOC-2026010501");
    expect(existsSync(join(".tasks", "ADHOC-2026010501.json"))).toBe(true);
  });
});
