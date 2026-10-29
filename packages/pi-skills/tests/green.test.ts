import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "..", "skills", "verify", "scripts", "green.sh");

function sh(cwd: string, args: string[]): { code: number; out: string } {
  const proc = Bun.spawnSync(args, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
  return { code: proc.exitCode ?? -1, out: proc.stdout.toString() + proc.stderr.toString() };
}

describe("verify/scripts/green.sh", () => {
  let repo = "";

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "green-"));
    sh(repo, ["git", "init", "-q"]);
    sh(repo, ["git", "config", "user.email", "t@example.com"]);
    sh(repo, ["git", "config", "user.name", "t"]);
    writeFileSync(join(repo, "a.txt"), "one\n");
    sh(repo, ["git", "add", "a.txt"]);
    sh(repo, ["git", "commit", "-qm", "init"]);
  });

  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  test("check exits 2 when nothing recorded", () => {
    expect(sh(repo, [script, "check"]).code).toBe(2);
  });

  test("mark then check is green", () => {
    expect(sh(repo, [script, "mark"]).code).toBe(0);
    expect(sh(repo, [script, "check"]).code).toBe(0);
  });

  test("edit to a tracked file makes it stale", () => {
    sh(repo, [script, "mark"]);
    writeFileSync(join(repo, "a.txt"), "two\n");
    expect(sh(repo, [script, "check"]).code).toBe(1);
  });

  test("new untracked file makes it stale; ignored file does not", () => {
    writeFileSync(join(repo, ".gitignore"), ".tasks/\n");
    sh(repo, ["git", "add", ".gitignore"]);
    sh(repo, ["git", "commit", "-qm", "ignore"]);
    sh(repo, [script, "mark"]);
    sh(repo, ["mkdir", "-p", join(repo, ".tasks")]);
    writeFileSync(join(repo, ".tasks", "x.json"), "{}");
    expect(sh(repo, [script, "check"]).code).toBe(0);
    writeFileSync(join(repo, "new.txt"), "x\n");
    expect(sh(repo, [script, "check"]).code).toBe(1);
  });

  test("committing the verified tree stays green", () => {
    writeFileSync(join(repo, "a.txt"), "two\n");
    sh(repo, [script, "mark"]);
    sh(repo, ["git", "commit", "-qam", "change"]);
    expect(sh(repo, [script, "check"]).code).toBe(0);
  });

  test("review marker is independent of verify marker", () => {
    sh(repo, [script, "mark"]);
    expect(sh(repo, [script, "check", "review"]).code).toBe(2);
    expect(sh(repo, [script, "mark", "review"]).code).toBe(0);
    expect(sh(repo, [script, "check", "review"]).code).toBe(0);
    writeFileSync(join(repo, "a.txt"), "two\n");
    expect(sh(repo, [script, "check", "review"]).code).toBe(1);
    expect(sh(repo, [script, "check"]).code).toBe(1);
  });

  test("unknown kind exits 64", () => {
    expect(sh(repo, [script, "check", "bogus"]).code).toBe(64);
  });

  test("outside a git repo exits 3", () => {
    const plain = mkdtempSync(join(tmpdir(), "plain-"));
    try {
      expect(sh(plain, [script, "check"]).code).toBe(3);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
