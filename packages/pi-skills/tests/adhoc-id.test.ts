import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nextSyntheticWorkItemId } from "../../accord-core/src/work-items/synthetic.js";
import { cleanEnv } from "./helpers.js";

const script = join(import.meta.dir, "..", "skills", "brief", "scripts", "adhoc-id.sh");

describe("brief/scripts/adhoc-id.sh", () => {
  let dir = "";
  let env: Record<string, string>;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "adhoc-"));
    // Pin the date with a `date` shim so the test never depends on the wall clock.
    const bin = join(dir, "bin");
    mkdirSync(bin);
    // Only the exact local-date format is answered; any other call fails the script.
    writeFileSync(
      join(bin, "date"),
      '#!/bin/sh\n[ "$*" = "+%Y%m%d" ] && echo 20260105 || exit 9\n',
    );
    chmodSync(join(bin, "date"), 0o755);
    env = cleanEnv({ PATH: `${bin}:${process.env.PATH ?? ""}` });
    mkdirSync(join(dir, "work"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function run(): { code: number; out: string } {
    const proc = Bun.spawnSync([script], {
      cwd: join(dir, "work"),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    return { code: proc.exitCode ?? -1, out: proc.stdout.toString().trim() };
  }

  test("first id of the day, in the core id format", () => {
    const result = run();
    expect(result.code).toBe(0);
    expect(result.out).toBe("ADHOC-2026010501");
    expect(result.out).toMatch(/^[A-Z]+(?:-[A-Z]+)*-\d+$/);
  });

  test("skips ids with a work item file or a docs/dev directory", () => {
    mkdirSync(join(dir, "work", ".tasks"));
    writeFileSync(join(dir, "work", ".tasks", "ADHOC-2026010501.json"), "{}");
    mkdirSync(join(dir, "work", "docs", "dev", "ADHOC-2026010502"), { recursive: true });
    expect(run().out).toBe("ADHOC-2026010503");
  });

  test("exits 1 when all 99 ids of the day are taken", () => {
    mkdirSync(join(dir, "work", ".tasks"));
    for (let slot = 1; slot <= 99; slot++) {
      const id = `ADHOC-20260105${String(slot).padStart(2, "0")}`;
      writeFileSync(join(dir, "work", ".tasks", `${id}.json`), "{}");
    }
    const result = run();
    expect(result.code).toBe(1);
    expect(result.out).toBe("");
  });

  test("slot boundaries: 10 is padded as 10, 99 is usable, a full day exits 1 with no output", () => {
    const take = (upTo: number) => {
      mkdirSync(join(dir, "work", ".tasks"), { recursive: true });
      for (let slot = 1; slot <= upTo; slot++) {
        const id = `ADHOC-20260105${String(slot).padStart(2, "0")}`;
        writeFileSync(join(dir, "work", ".tasks", `${id}.json`), "{}");
      }
    };
    take(9);
    expect(run()).toEqual({ code: 0, out: "ADHOC-2026010510" });
    take(98);
    expect(run()).toEqual({ code: 0, out: "ADHOC-2026010599" });
    take(99);
    expect(run()).toEqual({ code: 1, out: "" });
  });

  test("run from a subdirectory it still checks the git root", () => {
    Bun.spawnSync(["git", "init", "-q"], { cwd: join(dir, "work"), env });
    mkdirSync(join(dir, "work", ".tasks"));
    writeFileSync(join(dir, "work", ".tasks", "ADHOC-2026010501.json"), "{}");
    mkdirSync(join(dir, "work", "src"));
    const proc = Bun.spawnSync([script], {
      cwd: join(dir, "work", "src"),
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(proc.stdout.toString().trim()).toBe("ADHOC-2026010502");
  });

  test("agrees with the core generator for the same date and taken ids", () => {
    mkdirSync(join(dir, "work", ".tasks"));
    const taken = new Set(["ADHOC-2026010501", "ADHOC-2026010502"]);
    for (const id of taken) writeFileSync(join(dir, "work", ".tasks", `${id}.json`), "{}");
    const fromCore = nextSyntheticWorkItemId((id) => taken.has(id), new Date(2026, 0, 5));
    expect(run().out).toBe(fromCore);
    expect(fromCore).toBe("ADHOC-2026010503");
  });
});
