import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

  test("inside resolves .. even through directories that do not exist", () => {
    const cases: Array<[string, number]> = [
      [`${linked}/../../README.md`, 1],
      [`${linked}/newdir/../../x`, 1],
      [`${linked}/src/../a.ts`, 0],
      [`${linked}/./src/./a.ts`, 0],
      [`${linked}/..`, 1],
    ];
    for (const [target, code] of cases) {
      expect([target, sh(repo, [script, "inside", linked, target]).code]).toEqual([target, code]);
    }
  });

  test("inside resolves relative paths against the cwd", () => {
    expect(sh(linked, [script, "inside", linked, "src/x.ts"]).code).toBe(0);
    expect(sh(repo, [script, "inside", linked, "README.md"]).code).toBe(1);
    expect(sh(linked, [script, "inside", linked, "../../README.md"]).code).toBe(1);
  });

  test("inside follows symlinks: a link to the main checkout is outside", () => {
    writeFileSync(join(repo, "outside.txt"), "x");
    symlinkSync(join(repo, "outside.txt"), join(linked, "link-to-file"));
    symlinkSync(repo, join(linked, "link-to-dir"));
    symlinkSync(join(linked, "inner"), join(linked, "link-inside"));
    mkdirSync(join(linked, "inner"));
    expect(sh(repo, [script, "inside", linked, join(linked, "link-to-file")]).code).toBe(1);
    expect(sh(repo, [script, "inside", linked, join(linked, "link-to-dir", "x")]).code).toBe(1);
    expect(sh(repo, [script, "inside", linked, join(linked, "link-inside", "f")]).code).toBe(0);
  });

  test("inside fails closed on long symlink chains and on newlines in the path", () => {
    // 25 chained links ending outside the root: the resolver gives up and the path counts as outside.
    symlinkSync(join(repo, "outside.txt"), join(linked, "l25"));
    for (let level = 24; level >= 0; level--) {
      symlinkSync(join(linked, `l${level + 1}`), join(linked, `l${level}`));
    }
    const chain = sh(repo, [script, "inside", linked, join(linked, "l0")]);
    expect(chain.code).toBe(1);
    expect(chain.out).toContain("too many levels of symbolic links");
    const newline = sh(repo, [script, "inside", linked, `${linked}/a\n/../../x`]);
    expect(newline.code).toBe(1);
    expect(newline.out).toContain("newline");
  });

  test("inside requires both physical and lexical .. resolution to stay in the root", () => {
    mkdirSync(join(linked, "a", "b", "c"), { recursive: true });
    symlinkSync(join(linked, "a", "b", "c"), join(linked, "link"));
    // Physically a/x (inside); textually linked/../x (outside): rejected.
    expect(sh(repo, [script, "inside", linked, `${linked}/link/../../x`]).code).toBe(1);
    // Both readings inside.
    expect(sh(repo, [script, "inside", linked, `${linked}/link/../x`]).code).toBe(0);
  });

  test("inside handles spaces, relative symlink targets and a root reached through a symlink", () => {
    const spaced = join(repo, ".worktrees", "My Project");
    sh(repo, ["git", "worktree", "add", "-q", "-b", "wt/spaced2", spaced]);
    expect(sh(repo, [script, "inside", spaced, join(spaced, "src", "a b.ts")]).code).toBe(0);
    expect(sh(repo, [script, "inside", spaced, join(spaced, "..", "STEP-1", "x")]).code).toBe(1);
    writeFileSync(join(repo, "outside.txt"), "x");
    symlinkSync("../../outside.txt", join(spaced, "rel"));
    expect(sh(repo, [script, "inside", spaced, join(spaced, "rel")]).code).toBe(1);
    mkdirSync(join(spaced, "inner"));
    symlinkSync("inner", join(spaced, "rel-inside"));
    expect(sh(repo, [script, "inside", spaced, join(spaced, "rel-inside", "f")]).code).toBe(0);
    const rootLink = join(repo, "root-link");
    symlinkSync(spaced, rootLink);
    expect(sh(repo, [script, "inside", rootLink, join(spaced, "src", "x.ts")]).code).toBe(0);
    expect(sh(repo, [script, "inside", rootLink, join(repo, "README.md")]).code).toBe(1);
  });

  test("find prints the full path when the worktree directory contains a space", () => {
    const spaced = join(repo, ".worktrees", "My Project");
    sh(repo, ["git", "worktree", "add", "-q", "-b", "wt/spaced", spaced]);
    const result = sh(repo, [script, "find", "wt/spaced"]);
    expect(result.code).toBe(0);
    expect(result.out.trim()).toBe(spaced);
  });

  test("find matches a branch-only query and lists every match", () => {
    const other = join(repo, ".worktrees", "other");
    sh(repo, ["git", "worktree", "add", "-q", "-b", "feature/ABC-2", other]);
    expect(sh(repo, [script, "find", "ABC-2"]).out.trim()).toBe(other);
    sh(repo, [
      "git",
      "worktree",
      "add",
      "-q",
      "-b",
      "wt/STEP-10",
      join(repo, ".worktrees", "STEP-10"),
    ]);
    expect(sh(repo, [script, "find", "STEP-1"]).out.trim().split("\n").length).toBe(2);
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
      const env = { ...process.env, GIT_CEILING_DIRECTORIES: plain };
      const proc = Bun.spawnSync([script, "where"], {
        cwd: plain,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(proc.exitCode).toBe(3);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
    expect(sh(repo, [script, "bogus"]).code).toBe(64);
  });
});
