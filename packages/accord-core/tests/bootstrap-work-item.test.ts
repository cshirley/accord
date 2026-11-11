import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootstrapWorkItem } from "@clive.shirley/accord-core/work-items/bootstrap.js";

let tempCwd: string;
let originalCwd: string;

beforeEach(() => {
  setSystemTime(new Date(2026, 0, 5, 12, 0, 0));
  originalCwd = process.cwd();
  tempCwd = mkdtempSync(join(tmpdir(), "accord-bootstrap-core-"));
  // A git root stops the work item lookup from walking up into ancestor `.tasks` directories.
  Bun.spawnSync(["git", "init", "-q"], { cwd: tempCwd });
  process.chdir(tempCwd);
  mkdirSync(".tasks", { recursive: true });
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tempCwd, { recursive: true, force: true });
  setSystemTime();
});

const base = { pattern: "implement", variant: "standard" };

describe("bootstrapWorkItem", () => {
  test("creates a ticket-keyed work item and chooses the next command from the entry phase", () => {
    const result = bootstrapWorkItem({ id: "STEP-7", title: "add refresh", ...base });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.next).toBe("accord align STEP-7");
    expect(result.value.work_item.phase).toBe("aligning");
    expect(existsSync(result.value.path)).toBe(true);
  });

  test("each pattern and variant gets the right next command", () => {
    const cases: Array<[string, string, string]> = [
      ["quick_fix", "standard", "resume"],
      ["investigate", "standard", "resume"],
      ["infra", "standard", "resume"],
      ["analyse", "standard", "resume"],
      ["implement", "express", "resume"],
      ["implement", "orchestrated", "align"],
    ];
    cases.forEach(([pattern, variant, verb], index) => {
      const id = `STEP-${100 + index}`;
      const result = bootstrapWorkItem({ id, title: "t", pattern, variant });
      expect(result.ok).toBe(true);
      if (result.ok)
        expect([pattern, variant, result.value.next]).toEqual([
          pattern,
          variant,
          `accord ${verb} ${id}`,
        ]);
    });
  });

  test("--adhoc allocates exact ids under a fixed clock and skips docs/dev collisions", () => {
    mkdirSync(join("docs", "dev", "ADHOC-2026010501"), { recursive: true });
    const first = bootstrapWorkItem({ adhoc: true, title: "first", ...base });
    const second = bootstrapWorkItem({ adhoc: true, title: "second", ...base });
    expect(first.ok && first.value.id).toBe("ADHOC-2026010502");
    expect(second.ok && second.value.id).toBe("ADHOC-2026010503");
  });

  test("--adhoc is refused for patterns that begin by fetching a tracker ticket", () => {
    for (const pattern of ["investigate", "analyse"]) {
      const result = bootstrapWorkItem({
        adhoc: true,
        title: "why slow",
        pattern,
        variant: "standard",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("Use a real ticket id");
    }
    expect(readdirSync(".tasks")).toEqual([]); // nothing was claimed
    const infra = bootstrapWorkItem({
      adhoc: true,
      title: "plan the VPC",
      pattern: "infra",
      variant: "standard",
    });
    expect(infra.ok).toBe(true);
  });

  test("an id file created by another process (even empty or foreign) blocks that id; --adhoc skips to the next slot", () => {
    writeFileSync(join(".tasks", "ADHOC-2026010501.json"), "");
    writeFileSync(join(".tasks", "ADHOC-2026010502.json"), "{}");
    const adhoc = bootstrapWorkItem({ adhoc: true, title: "x", ...base });
    expect(adhoc.ok && adhoc.value.id).toBe("ADHOC-2026010503");
    writeFileSync(join(".tasks", "STEP-9.json"), "not json");
    const explicit = bootstrapWorkItem({ id: "STEP-9", title: "x", ...base });
    expect(explicit.ok).toBe(false);
    expect(readFileSync(join(".tasks", "STEP-9.json"), "utf8")).toBe("not json");
  });

  test("no empty, partial or temp file is left behind, and a stale hidden temp file does not block", () => {
    writeFileSync(join(".tasks", ".ADHOC-2026010501.json.new-1-1"), "partial");
    const result = bootstrapWorkItem({ adhoc: true, title: "x", ...base });
    expect(result.ok && result.value.id).toBe("ADHOC-2026010501");
    const files = readdirSync(".tasks").sort();
    expect(files).toEqual([".ADHOC-2026010501.json.new-1-1", "ADHOC-2026010501.json"]);
    expect(JSON.parse(readFileSync(join(".tasks", "ADHOC-2026010501.json"), "utf8")).id).toBe(
      "ADHOC-2026010501",
    );
  });

  test("the injected clock (not the system clock) names ad-hoc ids", () => {
    const result = bootstrapWorkItem({
      adhoc: true,
      title: "x",
      ...base,
      now: new Date(2026, 9, 29, 12),
    });
    expect(result.ok && result.value.id).toBe("ADHOC-2026102901");
  });

  test("a symlinked .tasks directory is refused", () => {
    rmSync(".tasks", { recursive: true });
    const outside = mkdtempSync(join(tmpdir(), "accord-outside-"));
    try {
      symlinkSync(outside, ".tasks");
      const result = bootstrapWorkItem({ id: "STEP-1", title: "x", ...base });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toContain("symlink");
      expect(readdirSync(outside)).toEqual([]);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });

  test("refuses with a specific message each: existing item, docs/dev only, bad input", () => {
    expect(bootstrapWorkItem({ id: "STEP-8", title: "one", ...base }).ok).toBe(true);
    const again = bootstrapWorkItem({ id: "STEP-8", title: "two", ...base });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toContain("already exists");
    expect(JSON.parse(readFileSync(join(".tasks", "STEP-8.json"), "utf8")).title).toBe("one");

    mkdirSync(join("docs", "dev", "STEP-4"), { recursive: true });
    const docsOnly = bootstrapWorkItem({ id: "STEP-4", title: "x", ...base });
    expect(docsOnly.ok).toBe(false);
    expect(existsSync(join(".tasks", "STEP-4.json"))).toBe(false);

    const before = readdirSync(".tasks");
    const table: Array<[Parameters<typeof bootstrapWorkItem>[0], string]> = [
      [{ id: "STEP-5", title: "STEP-123", ...base }, "not be a ticket id"],
      [{ id: "not-an-id", title: "t", ...base }, "is not a work item id"],
      [{ id: "MY_TEAM_5", title: "t", ...base }, "is not a work item id"],
      [
        { id: "STEP-6", title: "t", pattern: "nope", variant: "standard" },
        "--pattern must be one of",
      ],
      [
        { id: "STEP-6", title: "t", pattern: "implement", variant: "nope" },
        "--variant must be one of",
      ],
      [{ id: "STEP-6", title: "   ", ...base }, "requires a title"],
      [{ adhoc: true, id: "STEP-6", title: "t", ...base }, "do not pass one"],
    ];
    for (const [input, message] of table) {
      const result = bootstrapWorkItem(input);
      expect([message, result.ok]).toEqual([message, false]);
      if (!result.ok) expect(result.error).toContain(message);
    }
    expect(readdirSync(".tasks")).toEqual(before);
  });

  test("concurrent allocators never share an id (exclusive publish)", async () => {
    const script = join(tempCwd, "alloc.ts");
    await Bun.write(
      script,
      `import { bootstrapWorkItem } from ${JSON.stringify(join(import.meta.dir, "..", "src", "work-items", "bootstrap.ts"))};
const ids = [];
for (let n = 0; n < 6; n++) {
  const r = bootstrapWorkItem({ adhoc: true, title: "t" + n, pattern: "implement", variant: "standard", now: new Date(2026, 0, 5, 12) });
  if (r.ok) ids.push(r.value.id); else console.error(r.error);
}
console.log(JSON.stringify(ids));`,
    );
    const procs = [1, 2, 3].map(() =>
      Bun.spawn([process.execPath, script], { cwd: tempCwd, stdout: "pipe", stderr: "pipe" }),
    );
    const results = await Promise.all(
      procs.map(async (proc) => {
        const [out, errText, code] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
          proc.exited,
        ]);
        expect([code, errText]).toEqual([0, ""]);
        return JSON.parse(out.trim()) as string[];
      }),
    );
    const all = results.flat();
    expect(all.length).toBe(18);
    expect(new Set(all).size).toBe(18);
    expect(readdirSync(".tasks").filter((name) => name.startsWith("ADHOC-")).length).toBe(18);
  }, 30_000);
});
