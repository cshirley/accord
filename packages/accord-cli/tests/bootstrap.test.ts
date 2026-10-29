import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBootstrapArgs, runBootstrapCommand } from "../src/commands/bootstrap.js";

let tempCwd: string;
let originalCwd: string;
let logged: string[];
let errors: string[];
const realLog = console.log;
const realError = console.error;

beforeEach(() => {
  originalCwd = process.cwd();
  tempCwd = mkdtempSync(join(tmpdir(), "accord-bootstrap-"));
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
});

function run(tail: string[], json = false): number {
  const parsed = parseBootstrapArgs(tail);
  if (!parsed.ok) throw new Error(parsed.message);
  return runBootstrapCommand(parsed.args, { json });
}

describe("accord bootstrap", () => {
  test("creates a work item from id and title with a real title", () => {
    expect(run(["STEP-7", "add", "token", "refresh"])).toBe(0);
    const wi = JSON.parse(readFileSync(join(".tasks", "STEP-7.json"), "utf8"));
    expect(wi.title).toBe("add token refresh");
    expect(wi.pattern).toBe("implement");
    expect(wi.phase).toBe("aligning");
  });

  test("--adhoc generates ADHOC ids and increments", () => {
    expect(run(["--adhoc", "first", "thing"], true)).toBe(0);
    expect(run(["--adhoc", "second", "thing"], true)).toBe(0);
    const ids = logged.map((line) => (JSON.parse(line) as { id: string }).id);
    expect(ids[0]).toMatch(/^ADHOC-\d{8}01$/);
    expect(ids[1]).toMatch(/^ADHOC-\d{8}02$/);
    expect(existsSync(join(".tasks", `${ids[0]}.json`))).toBe(true);
  });

  test("--adhoc skips an id that already has docs/dev/<ID>", () => {
    expect(run(["--adhoc", "x"], true)).toBe(0);
    const first = (JSON.parse(logged[0]) as { id: string }).id;
    rmSync(join(".tasks", `${first}.json`));
    mkdirSync(join("docs", "dev", first), { recursive: true });
    logged.length = 0;
    expect(run(["--adhoc", "y"], true)).toBe(0);
    expect((JSON.parse(logged[0]) as { id: string }).id).not.toBe(first);
  });

  test("refuses an existing work item", () => {
    expect(run(["STEP-8", "one"])).toBe(0);
    expect(run(["STEP-8", "two"])).toBe(1);
    expect(errors.join("\n")).toContain("already exists");
  });

  test("refuses a ticket-shaped title (would trigger a tracker lookup)", () => {
    expect(run(["--adhoc", "STEP-123"])).toBe(1);
    expect(errors.join("\n")).toContain("title must describe the work");
  });

  test("refuses an id that is not a work item id", () => {
    expect(run(["not-an-id", "title"])).toBe(1);
  });
});
