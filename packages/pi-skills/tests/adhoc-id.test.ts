import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "..", "skills", "brief", "scripts", "adhoc-id.sh");

function today(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}${month}${day}`;
}

function run(cwd: string): { code: number; out: string } {
  const proc = Bun.spawnSync([script], { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: proc.exitCode ?? -1, out: proc.stdout.toString().trim() };
}

describe("brief/scripts/adhoc-id.sh", () => {
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "adhoc-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("first id of the day, in the core id format", () => {
    const result = run(dir);
    expect(result.code).toBe(0);
    expect(result.out).toBe(`ADHOC-${today()}01`);
    expect(result.out).toMatch(/^[A-Z]+(?:-[A-Z]+)*-\d+$/);
  });

  test("skips ids with a work item file or a docs/dev directory", () => {
    mkdirSync(join(dir, ".tasks"));
    writeFileSync(join(dir, ".tasks", `ADHOC-${today()}01.json`), "{}");
    mkdirSync(join(dir, "docs", "dev", `ADHOC-${today()}02`), { recursive: true });
    expect(run(dir).out).toBe(`ADHOC-${today()}03`);
  });
});
