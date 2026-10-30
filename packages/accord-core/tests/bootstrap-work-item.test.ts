import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
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

  test("refuses: existing item, docs/dev only, ticket-shaped title, bad id, bad pattern/variant, empty title", () => {
    expect(bootstrapWorkItem({ id: "STEP-8", title: "one", ...base }).ok).toBe(true);
    const again = bootstrapWorkItem({ id: "STEP-8", title: "two", ...base });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toContain("already exists");
    expect(JSON.parse(readFileSync(join(".tasks", "STEP-8.json"), "utf8")).title).toBe("one");

    mkdirSync(join("docs", "dev", "STEP-4"), { recursive: true });
    expect(bootstrapWorkItem({ id: "STEP-4", title: "x", ...base }).ok).toBe(false);
    expect(existsSync(join(".tasks", "STEP-4.json"))).toBe(false);

    const before = readdirSync(".tasks");
    for (const input of [
      { id: "STEP-5", title: "STEP-123", ...base },
      { id: "not-an-id", title: "t", ...base },
      { id: "STEP-6", title: "t", pattern: "nope", variant: "standard" },
      { id: "STEP-6", title: "t", pattern: "implement", variant: "nope" },
      { id: "STEP-6", title: "   ", ...base },
      { adhoc: true, id: "STEP-6", title: "t", ...base },
    ]) {
      expect(bootstrapWorkItem(input).ok).toBe(false);
    }
    expect(readdirSync(".tasks")).toEqual(before);
  });

  test("concurrent allocators never share an id (exclusive claim)", async () => {
    const script = join(tempCwd, "alloc.ts");
    await Bun.write(
      script,
      `import { bootstrapWorkItem } from ${JSON.stringify(join(import.meta.dir, "..", "src", "work-items", "bootstrap.ts"))};
const ids = [];
for (let n = 0; n < 6; n++) {
  const r = bootstrapWorkItem({ adhoc: true, title: "t" + n, pattern: "implement", variant: "standard" });
  if (r.ok) ids.push(r.value.id);
}
console.log(JSON.stringify(ids));`,
    );
    const run = () =>
      Bun.spawn([process.execPath, script], { cwd: tempCwd, stdout: "pipe", stderr: "pipe" });
    const procs = [run(), run(), run()];
    const outputs = await Promise.all(
      procs.map(
        async (proc) => JSON.parse((await new Response(proc.stdout).text()).trim()) as string[],
      ),
    );
    const all = outputs.flat();
    expect(all.length).toBe(18);
    expect(new Set(all).size).toBe(18);
  });
});
