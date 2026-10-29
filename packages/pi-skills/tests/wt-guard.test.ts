import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "..", "skills", "worktree", "scripts", "wt-guard.sh");

function sh(cwd: string, args: string[]): { code: number; out: string } {
  const proc = Bun.spawnSync(args, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
  return { code: proc.exitCode ?? -1, out: proc.stdout.toString() + proc.stderr.toString() };
}

describe("worktree/scripts/wt-guard.sh", () => {
  let repo = "";
  let linked = "";

  beforeEach(() => {
    repo = realpathSync(mkdtempSync(join(tmpdir(), "wtg-")));
    sh(repo, ["git", "init", "-q", "-b", "main"]);
    sh(repo, ["git", "config", "user.email", "t@example.com"]);
    sh(repo, ["git", "config", "user.name", "t"]);
    sh(repo, ["git", "commit", "-q", "--allow-empty", "-m", "init"]);
    mkdirSync(join(repo, ".worktrees"));
    linked = join(repo, ".worktrees", "STEP-1");
    sh(repo, ["git", "worktree", "add", "-q", "-b", "wt/STEP-1", linked]);
  });

  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  test("where reports main checkout and linked worktree", () => {
    const main = sh(repo, [script, "where"]);
    expect(main.out).toContain("kind=main-checkout");
    expect(main.out).toContain("wt/STEP-1");
    const wt = sh(linked, [script, "where"]);
    expect(wt.out).toContain("kind=linked-worktree");
    expect(wt.out).toContain(`root=${linked}`);
    expect(wt.out).toContain("branch=wt/STEP-1");
  });

  test("inside accepts paths in root, including not-yet-created files", () => {
    expect(sh(repo, [script, "inside", linked, join(linked, "src", "new.ts"), linked]).code).toBe(
      0,
    );
  });

  test("inside rejects the main checkout and sibling-prefix paths", () => {
    const res = sh(repo, [script, "inside", linked, join(repo, "README.md")]);
    expect(res.code).toBe(1);
    expect(res.out).toContain("outside:");
    expect(sh(repo, [script, "inside", linked, `${linked}-other/x`]).code).toBe(1);
  });

  test("find matches by path or branch", () => {
    const byPath = sh(repo, [script, "find", "STEP-1"]);
    expect(byPath.code).toBe(0);
    expect(byPath.out.trim()).toBe(linked);
    expect(sh(repo, [script, "find", "NOPE-9"]).code).toBe(1);
  });

  test("outside a git repo exits 3; bad usage exits 64", () => {
    const plain = realpathSync(mkdtempSync(join(tmpdir(), "plain-")));
    try {
      expect(sh(plain, [script, "where"]).code).toBe(3);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
    expect(sh(repo, [script, "bogus"]).code).toBe(64);
  });
});
