import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "..", "skills", "verify", "scripts", "green.sh");
const REVIEW_FLAGS = ["--source", "branch", "--critical", "0"];

function sh(
  cwd: string,
  args: string[],
  extraEnv: Record<string, string> = {},
): { code: number; out: string } {
  const proc = Bun.spawnSync(args, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      ...extraEnv,
    },
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
    expect(sh(repo, [script, "mark", "review", ...REVIEW_FLAGS]).code).toBe(0);
    expect(sh(repo, [script, "check", "review"]).code).toBe(0);
    writeFileSync(join(repo, "a.txt"), "two\n");
    expect(sh(repo, [script, "check", "review"]).code).toBe(1);
    expect(sh(repo, [script, "check"]).code).toBe(1);
  });

  test("unknown kind exits 64", () => {
    expect(sh(repo, [script, "check", "bogus"]).code).toBe(64);
  });

  test("never stages files or writes objects in the real repository", () => {
    writeFileSync(join(repo, "new.txt"), "secret-ish\n");
    const objectsBefore = sh(repo, ["git", "count-objects", "-v"]).out;
    expect(sh(repo, [script, "mark"]).code).toBe(0);
    expect(sh(repo, [script, "check"]).code).toBe(0);
    expect(sh(repo, ["git", "status", "--porcelain"]).out.trim()).toBe("?? new.txt");
    expect(sh(repo, ["git", "diff", "--cached", "--name-only"]).out.trim()).toBe("");
    expect(sh(repo, ["git", "count-objects", "-v"]).out).toBe(objectsBefore);
    const looseDirs = readdirSync(join(repo, ".git", "objects")).filter((d) => d.length === 2);
    expect(looseDirs.length).toBeGreaterThan(0);
  });

  test("deleting a tracked file makes it stale", () => {
    sh(repo, [script, "mark"]);
    rmSync(join(repo, "a.txt"));
    expect(sh(repo, [script, "check"]).code).toBe(1);
  });

  test("a same-size edit right after marking is detected", () => {
    for (let round = 0; round < 5; round++) {
      writeFileSync(join(repo, "a.txt"), `v${round}\n`);
      sh(repo, [script, "mark"]);
      writeFileSync(join(repo, "a.txt"), `w${round}\n`);
      expect(sh(repo, [script, "check"]).code).toBe(1);
    }
  });

  test("markers are per worktree", () => {
    const linked = `${repo}-wt`;
    try {
      sh(repo, ["git", "worktree", "add", "-q", "-b", "other", linked]);
      sh(repo, [script, "mark"]);
      expect(sh(linked, [script, "check"]).code).toBe(2);
      sh(linked, [script, "mark"]);
      expect(sh(linked, [script, "check"]).code).toBe(0);
      expect(sh(repo, [script, "check"]).code).toBe(0);
    } finally {
      rmSync(linked, { recursive: true, force: true });
    }
  });

  test("show prints the record; fingerprint prints a tree hash; bad usage exits 64", () => {
    expect(sh(repo, [script, "show"]).code).toBe(2);
    sh(repo, [script, "mark"]);
    expect(sh(repo, [script, "show"]).out).toMatch(/^tree=[0-9a-f]{40,64}\nhead=/);
    expect(sh(repo, [script, "fingerprint"]).out.trim()).toMatch(/^[0-9a-f]{40,64}$/);
    expect(sh(repo, [script, "bogus"]).code).toBe(64);
    expect(sh(repo, [script, "mark", "--source", "x"]).code).toBe(64);
    expect(sh(repo, [script, "mark", "verify", "--critical", "1"]).code).toBe(64);
    expect(sh(repo, [script, "mark", "review", "--critical", "many"]).code).toBe(64);
  });

  // Root can read every file, so the failure cannot be provoked there; skip instead of passing.
  const asRoot = process.getuid?.() === 0;

  test.skipIf(asRoot)(
    "an unreadable untracked directory fails loudly instead of recording a partial fingerprint",
    () => {
      const blocked = join(repo, "blocked");
      mkdirSync(blocked);
      writeFileSync(join(blocked, "f"), "x");
      chmodSync(blocked, 0o000);
      try {
        const result = sh(repo, [script, "mark"]);
        expect(result.code).toBe(4);
        expect(result.out).toContain("fingerprint failed");
        expect(sh(repo, [script, "check"]).code).toBe(2); // nothing was recorded
      } finally {
        chmodSync(blocked, 0o755);
      }
    },
  );

  test.skipIf(asRoot)("an unreadable untracked file fails loudly too", () => {
    const secret = join(repo, "secret.txt");
    writeFileSync(secret, "x");
    chmodSync(secret, 0o000);
    try {
      expect(sh(repo, [script, "mark"]).code).toBe(4);
    } finally {
      chmodSync(secret, 0o644);
    }
  });

  test("review mark captured before the review goes stale when edits land during it", () => {
    const captured = sh(repo, [script, "fingerprint"]).out.trim();
    writeFileSync(join(repo, "a.txt"), "edited while reviewers ran\n");
    expect(
      sh(repo, [
        script,
        "mark",
        "review",
        "--tree",
        captured,
        "--source",
        "branch",
        "--critical",
        "0",
      ]).code,
    ).toBe(0);
    expect(sh(repo, [script, "check", "review"]).code).toBe(1);
  });

  test("review with open Critical findings blocks until accepted with a reason", () => {
    sh(repo, [script, "mark", "review", "--source", "branch", "--critical", "2"]);
    const blocked = sh(repo, [script, "check", "review"]);
    expect(blocked.code).toBe(1);
    expect(blocked.out).toContain("2 open Critical");
    sh(repo, [
      script,
      "mark",
      "review",
      "--source",
      "branch",
      "--critical",
      "2",
      "--accepted",
      "known; tracked in STEP-1",
    ]);
    expect(sh(repo, [script, "check", "review"]).code).toBe(0);
    sh(repo, [script, "mark", "review", "--source", "branch", "--critical", "0"]);
    expect(sh(repo, [script, "check", "review"]).code).toBe(0);
  });

  test("a local-source review does not cover commits ahead of origin/HEAD", () => {
    sh(repo, ["git", "update-ref", "refs/remotes/origin/main", "HEAD"]);
    sh(repo, ["git", "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
    writeFileSync(join(repo, "a.txt"), "two\n");
    sh(repo, ["git", "commit", "-qam", "ahead"]);
    sh(repo, [script, "mark", "review", "--source", "local", "--critical", "0"]);
    const blocked = sh(repo, [script, "check", "review"]);
    expect(blocked.code).toBe(1);
    expect(blocked.out).toContain("1 commit(s) ahead of origin/HEAD");
    sh(repo, [script, "mark", "review", "--source", "branch", "--critical", "0"]);
    expect(sh(repo, [script, "check", "review"]).code).toBe(0);
  });

  test("a failing git add without any recognisable message still fails closed (exit 4)", () => {
    // Shim git so `add` fails with an arbitrary, non-English message and exit status.
    const realGit = Bun.which("git") as string;
    const bin = join(repo, "..", `shim-${Date.now()}`);
    mkdirSync(bin);
    writeFileSync(
      join(bin, "git"),
      `#!/bin/sh\nif [ "$1" = add ]; then echo "fatal: panne simulee" >&2; exit 128; fi\nexec "${realGit}" "$@"\n`,
    );
    chmodSync(join(bin, "git"), 0o755);
    try {
      const result = sh(repo, [script, "mark"], { PATH: `${bin}:${process.env.PATH ?? ""}` });
      expect(result.code).toBe(4);
      expect(result.out).toContain("fingerprint failed");
      expect(sh(repo, [script, "check"]).code).toBe(2);
    } finally {
      rmSync(bin, { recursive: true, force: true });
    }
  });

  test("mark review requires --source and --critical; --critical 08 is decimal", () => {
    expect(sh(repo, [script, "mark", "review"]).code).toBe(64);
    expect(sh(repo, [script, "mark", "review", "--source", "branch"]).code).toBe(64);
    expect(sh(repo, [script, "mark", "review", "--critical", "0"]).code).toBe(64);
    expect(sh(repo, [script, "mark", "review", "--source"]).code).toBe(64);
    expect(
      sh(repo, [script, "mark", "review", "--source", "branch", "--critical", "08"]).code,
    ).toBe(0);
    const blocked = sh(repo, [script, "check", "review"]);
    expect(blocked.code).toBe(1);
    expect(blocked.out).toContain("8 open Critical");
  });

  test("a review marker without a valid critical count is blocked (fail closed)", () => {
    sh(repo, [script, "mark", "review", ...REVIEW_FLAGS]);
    const marker = join(repo, ".git", "accord", "last-review");
    writeFileSync(marker, readFileSync(marker, "utf8").replace("critical=0", "critical=lots"));
    const blocked = sh(repo, [script, "check", "review"]);
    expect(blocked.code).toBe(1);
    expect(blocked.out).toContain("no valid critical count");
  });

  test("review -> commit -> check stays valid; commits ahead before the review do not", () => {
    sh(repo, ["git", "update-ref", "refs/remotes/origin/main", "HEAD"]);
    sh(repo, ["git", "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"]);
    // 1. review the uncommitted change, then commit exactly that change
    writeFileSync(join(repo, "a.txt"), "reviewed change\n");
    sh(repo, [script, "mark", "review", "--source", "local", "--critical", "0"]);
    sh(repo, ["git", "commit", "-qam", "the reviewed change"]);
    expect(sh(repo, [script, "check", "review"]).code).toBe(0);
    // 2. a second local review while that commit is ahead of origin/HEAD does not cover it
    writeFileSync(join(repo, "a.txt"), "another change\n");
    sh(repo, [script, "mark", "review", "--source", "local", "--critical", "0"]);
    const blocked = sh(repo, [script, "check", "review"]);
    expect(blocked.code).toBe(1);
    expect(blocked.out).toContain("1 commit(s) ahead of origin/HEAD");
  });

  test("a local review without origin/HEAD warns but passes", () => {
    sh(repo, [script, "mark", "review", "--source", "local", "--critical", "0"]);
    const result = sh(repo, [script, "check", "review"]);
    expect(result.code).toBe(0);
    expect(result.out).toContain("origin/HEAD is not set");
  });

  test("outside a git repo exits 3", () => {
    const plain = mkdtempSync(join(tmpdir(), "plain-"));
    try {
      // The ceiling keeps git from finding a repository above the temp dir when TMPDIR sits in one.
      expect(sh(plain, [script, "check"], { GIT_CEILING_DIRECTORIES: plain }).code).toBe(3);
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
