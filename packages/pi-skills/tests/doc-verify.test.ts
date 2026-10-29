import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "..", "skills", "doc-verify", "scripts", "doc-verify.py");

type Finding = { code: string; level: string; line: number; path: string; message: string };
type Result = { code: number; findings: Finding[]; stderr: string };

function git(cwd: string, args: string[]): string {
  const proc = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
  return proc.stdout.toString().trim();
}

function run(cwd: string, args: string[], env: Record<string, string> = {}): Result {
  const proc = Bun.spawnSync(["python3", script, "--json", "--today", "2026-10-29", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  const text = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  // A crash prints a traceback and no JSON; fail loudly instead of reading it as "no findings".
  expect(stderr).not.toContain("Traceback");
  const exitCode = proc.exitCode ?? -1;
  if (exitCode === 2) return { code: exitCode, findings: [], stderr };
  expect(text.trim().startsWith("[")).toBe(true);
  return { code: exitCode, findings: JSON.parse(text) as Finding[], stderr };
}

const codes = (findings: Finding[]) => findings.map((f) => f.code);

describe("doc-verify.py", () => {
  let dir = "";

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "docv-")));
    // A git root keeps relative-link and repo-root resolution inside the temp directory.
    git(dir, ["init", "-q"]);
    git(dir, ["config", "user.email", "t@example.com"]);
    git(dir, ["config", "user.name", "t"]);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function commit(message: string): string {
    git(dir, ["add", "-A"]);
    git(dir, ["commit", "-qm", message]);
    return git(dir, ["rev-parse", "HEAD"]);
  }

  test("clean doc passes with exit 0 and no findings", () => {
    writeFileSync(join(dir, "a.md"), "# A\n\nFact [verified] about things.\n");
    const result = run(dir, ["a.md"]);
    expect(result.code).toBe(0);
    expect(result.findings).toEqual([]);
  });

  test("broken relative link is an error; valid link and anchor pass", () => {
    writeFileSync(join(dir, "b.md"), "# B\n\n## Sub heading\n");
    writeFileSync(
      join(dir, "a.md"),
      "# A [verified]\n\n[ok](b.md) [anchor](b.md#sub-heading) [bad](missing.md) [web](https://x.test/y)\n",
    );
    const result = run(dir, ["a.md"]);
    expect(result.code).toBe(1);
    expect(codes(result.findings)).toEqual(["broken-link"]);
    expect(result.findings[0].message).toContain("missing.md");
  });

  test("percent-encoded link targets are decoded", () => {
    writeFileSync(join(dir, "my file.md"), "# B\n");
    writeFileSync(join(dir, "a.md"), "# A [verified]\n\n[ok](my%20file.md)\n");
    expect(run(dir, ["a.md"]).findings).toEqual([]);
  });

  test("bad anchor is a warning, not an error", () => {
    writeFileSync(join(dir, "b.md"), "# B\n");
    writeFileSync(join(dir, "a.md"), "# A [verified]\n\n[x](b.md#nope)\n");
    const result = run(dir, ["a.md"]);
    expect(result.code).toBe(0);
    expect(codes(result.findings)).toContain("broken-anchor");
  });

  test("links and tags inside code fences and inline code are ignored", () => {
    writeFileSync(
      join(dir, "a.md"),
      "# A [verified]\n\n```\n[bad](missing.md) [assumed]\n```\n\n`[bad](missing.md)`\n",
    );
    const result = run(dir, ["a.md"]);
    expect(result.code).toBe(0);
    expect(result.findings).toEqual([]);
  });

  test("a longer outer fence keeps inner fences (and their links) inside the code block", () => {
    writeFileSync(
      join(dir, "a.md"),
      "# A [verified]\n\n````markdown\n```js\n[bad](missing.md)\n```\n[also bad](missing2.md)\n````\n\nAfter [ok](a.md).\n",
    );
    const result = run(dir, ["a.md"]);
    expect(result.code).toBe(0);
    expect(result.findings).toEqual([]);
  });

  test("tilde fences are tracked separately from backtick fences", () => {
    writeFileSync(
      join(dir, "a.md"),
      "# A [verified]\n\n~~~\n```\n[bad](missing.md)\n~~~\n\n[real](missing.md)\n",
    );
    const result = run(dir, ["a.md"]);
    expect(codes(result.findings)).toEqual(["broken-link"]);
    expect(result.findings[0].line).toBe(8);
  });

  test("anchors after a nested fence still resolve (headings use the same fence tracker)", () => {
    writeFileSync(
      join(dir, "a.md"),
      "# A [verified]\n\n[later](#later-heading)\n\n````md\n```\n````\n\n## Later heading\n",
    );
    expect(run(dir, ["a.md"]).findings).toEqual([]);
  });

  test("a link that resolves outside the repo is only a warning and is not probed", () => {
    const sibling = join(dir, "..", `${dir.split("/").pop()}-sibling.md`);
    writeFileSync(sibling, "# S\n");
    try {
      writeFileSync(
        join(dir, "a.md"),
        `# A [verified]\n\n[out](../${sibling.split("/").pop()}) [gone](../does-not-exist.md)\n`,
      );
      const result = run(dir, ["a.md"]);
      // Neither the existing nor the missing target is stat-ed or opened: both just warn.
      expect(codes(result.findings)).toEqual(["link-outside-repo", "link-outside-repo"]);
      expect(result.code).toBe(0);
    } finally {
      rmSync(sibling, { force: true });
    }
  });

  test("future front matter date is an error; filename mismatch warns", () => {
    writeFileSync(
      join(dir, "2026-10-01-plan.md"),
      "---\ndate: 2026-12-25\n---\n# Plan [verified]\n",
    );
    const result = run(dir, ["2026-10-01-plan.md"]);
    expect(result.code).toBe(1);
    expect(codes(result.findings)).toContain("future-front-matter-date");
    expect(codes(result.findings)).toContain("filename-date-mismatch");
  });

  test("tomorrow is in the future, in front matter and in prose", () => {
    writeFileSync(
      join(dir, "a.md"),
      "---\ndate: 2026-10-30\n---\n# A [verified]\n\nShipped 2026-10-30.\n",
    );
    const result = run(dir, ["a.md"]);
    expect(result.code).toBe(1);
    expect(codes(result.findings).sort()).toEqual(["future-date", "future-front-matter-date"]);
  });

  test("a date equal to today is not in the future; a matching filename date does not warn", () => {
    writeFileSync(
      join(dir, "2026-10-29-note.md"),
      "---\ndate: 2026-10-29\n---\n# Note [verified]\n\nShipped 2026-10-29.\n",
    );
    const result = run(dir, ["2026-10-29-note.md"]);
    expect(result.code).toBe(0);
    expect(result.findings).toEqual([]);
  });

  test("future prose date warns unless the line has deadline wording", () => {
    writeFileSync(
      join(dir, "a.md"),
      "# A [verified]\n\nWe shipped on 2026-12-01.\nGo-live target is 2026-12-01.\n",
    );
    const result = run(dir, ["a.md"]);
    const future = result.findings.filter((f) => f.code === "future-date");
    expect(future.length).toBe(1);
    expect(future[0].line).toBe(3);
  });

  test("assumed tags warn; no tags is info", () => {
    writeFileSync(join(dir, "a.md"), "# A\n\nClaim [assumed].\n");
    expect(codes(run(dir, ["a.md"]).findings)).toContain("unconfirmed-assumptions");
    writeFileSync(join(dir, "b.md"), "# B\n\nPlain text.\n");
    expect(codes(run(dir, ["b.md"]).findings)).toEqual(["no-provenance-tags"]);
  });

  test("unclosed fence is an error", () => {
    writeFileSync(join(dir, "a.md"), "# A [verified]\n\n```js\nconst x = 1;\n");
    const result = run(dir, ["a.md"]);
    expect(result.code).toBe(1);
    expect(codes(result.findings)).toContain("unclosed-fence");
  });

  test("a non-UTF-8 file is read without a crash", () => {
    writeFileSync(join(dir, "a.md"), Buffer.from([0x23, 0x20, 0x41, 0x0a, 0xff, 0xfe, 0x0a]));
    const result = run(dir, ["a.md"]);
    expect(result.code).toBe(0);
  });

  describe("verified-against", () => {
    test("unknown sha errors; changed paths are stale evidence; unrelated changes are not", () => {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "x.ts"), "1\n");
      writeFileSync(join(dir, "other.txt"), "1\n");
      const sha = commit("one");
      writeFileSync(
        join(dir, "doc.md"),
        `---\nverified-against: ${sha}\nverified-paths: [src]\n---\n# D [verified]\n`,
      );
      expect(run(dir, ["doc.md"]).code).toBe(0);

      writeFileSync(join(dir, "other.txt"), "2\n");
      commit("unrelated");
      expect(run(dir, ["doc.md"]).code).toBe(0);

      writeFileSync(join(dir, "src", "x.ts"), "2\n");
      commit("two");
      const stale = run(dir, ["doc.md"]);
      expect(stale.code).toBe(1);
      expect(codes(stale.findings)).toContain("stale-evidence");

      writeFileSync(
        join(dir, "bad.md"),
        "---\nverified-against: 0000000000000000000000000000000000000000\n---\n# D [verified]\n",
      );
      expect(codes(run(dir, ["bad.md"]).findings)).toContain("verified-against");
    });

    test("the documented front matter example, comments included, is parsed correctly", () => {
      mkdirSync(join(dir, "src", "auth"), { recursive: true });
      writeFileSync(join(dir, "src", "auth", "a.ts"), "1\n");
      const sha = commit("one");
      writeFileSync(join(dir, "src", "auth", "a.ts"), "2\n");
      commit("two");
      writeFileSync(
        join(dir, "doc.md"),
        [
          "---",
          "date: 2026-10-29",
          `verified-against: ${sha}`,
          "verified-repo: .        # optional; default is the repo holding the document",
          "verified-paths: [\"src/auth\", 'docs/api'] # optional; enables stale-evidence",
          "---",
          "# D [verified]",
          "",
        ].join("\n"),
      );
      const result = run(dir, ["doc.md"]);
      expect(codes(result.findings)).toEqual(["stale-evidence"]);
      expect(result.findings[0].message).toContain("src/auth/a.ts");
    });

    test("empty verified-paths warns instead of silently doing nothing", () => {
      writeFileSync(join(dir, "a.txt"), "1\n");
      const sha = commit("one");
      writeFileSync(
        join(dir, "doc.md"),
        `---\nverified-against: ${sha}\nverified-paths: []\n---\n# D [verified]\n`,
      );
      expect(codes(run(dir, ["doc.md"]).findings)).toEqual(["verified-paths-empty"]);
    });

    test("a malformed sha is rejected before it reaches git", () => {
      for (const bad of ["--upload-pack=x", "HEAD", "abc", "$(id)", "main"]) {
        writeFileSync(join(dir, "doc.md"), `---\nverified-against: ${bad}\n---\n# D [verified]\n`);
        const result = run(dir, ["doc.md"]);
        expect(codes(result.findings)).toEqual(["verified-against"]);
        expect(result.findings[0].message).toContain("hex commit id");
      }
    });

    test("a document outside any git repo with a well-formed sha reports that it cannot verify", () => {
      const plain = realpathSync(mkdtempSync(join(tmpdir(), "docv-plain-")));
      try {
        writeFileSync(
          join(plain, "doc.md"),
          "---\nverified-against: abc1234\n---\n# D [verified]\n",
        );
        const result = run(plain, ["doc.md"], { GIT_CEILING_DIRECTORIES: plain });
        expect(result.code).toBe(1);
        expect(codes(result.findings)).toEqual(["verified-against"]);
        expect(result.findings[0].message).toContain("no git repo found");
      } finally {
        rmSync(plain, { recursive: true, force: true });
      }
    });

    test("a pathspec git rejects is reported, not silently treated as no changes", () => {
      writeFileSync(join(dir, "a.txt"), "1\n");
      const sha = commit("one");
      writeFileSync(
        join(dir, "doc.md"),
        `---\nverified-against: ${sha}\nverified-paths: [":(bad)x"]\n---\n# D [verified]\n`,
      );
      const result = run(dir, ["doc.md"]);
      expect(codes(result.findings)).toEqual(["verified-paths-unchecked"]);
      expect(result.code).toBe(0);
    });

    test("relative and symlinked verified-repo escapes are refused", () => {
      const other = realpathSync(mkdtempSync(join(tmpdir(), "docv-esc-")));
      try {
        git(other, ["init", "-q"]);
        git(other, ["config", "user.email", "t@example.com"]);
        git(other, ["config", "user.name", "t"]);
        writeFileSync(join(other, "f.txt"), "1\n");
        git(other, ["add", "-A"]);
        git(other, ["commit", "-qm", "one"]);
        const sha = git(other, ["rev-parse", "HEAD"]);
        symlinkSync(other, join(dir, "vendor"));
        const relative = `../${other.split("/").pop()}`;
        for (const declared of [relative, "vendor"]) {
          writeFileSync(
            join(dir, "doc.md"),
            `---\nverified-against: ${sha}\nverified-repo: ${declared}\n---\n# D [verified]\n`,
          );
          const result = run(dir, ["doc.md"]);
          expect([declared, codes(result.findings)]).toEqual([
            declared,
            ["verified-repo-not-allowed"],
          ]);
        }
        // Allowed explicitly, the same relative form verifies.
        writeFileSync(
          join(dir, "doc.md"),
          `---\nverified-against: ${sha}\nverified-repo: ${relative}\n---\n# D [verified]\n`,
        );
        expect(run(dir, ["--allow-repo", other, "doc.md"]).findings).toEqual([]);
      } finally {
        rmSync(other, { recursive: true, force: true });
      }
    });

    test("verified-repo outside the repo needs --allow-repo; inside is fine", () => {
      const other = realpathSync(mkdtempSync(join(tmpdir(), "docv-other-")));
      try {
        git(other, ["init", "-q"]);
        git(other, ["config", "user.email", "t@example.com"]);
        git(other, ["config", "user.name", "t"]);
        writeFileSync(join(other, "f.txt"), "1\n");
        git(other, ["add", "-A"]);
        git(other, ["commit", "-qm", "one"]);
        const sha = git(other, ["rev-parse", "HEAD"]);
        writeFileSync(
          join(dir, "doc.md"),
          `---\nverified-against: ${sha}\nverified-repo: ${other}\n---\n# D [verified]\n`,
        );
        const denied = run(dir, ["doc.md"]);
        expect(denied.code).toBe(1);
        expect(codes(denied.findings)).toEqual(["verified-repo-not-allowed"]);
        expect(run(dir, ["--allow-repo", other, "doc.md"]).findings).toEqual([]);
      } finally {
        rmSync(other, { recursive: true, force: true });
      }
    });
  });

  describe("mermaid", () => {
    const block = "# M [verified]\n\n```mermaid\nflowchart TD\n  A-->B\n```\n";

    function withFakeMmdc(body: string): Record<string, string> {
      const bin = join(dir, "bin");
      mkdirSync(bin);
      const mmdc = join(bin, "mmdc");
      writeFileSync(mmdc, `#!/bin/sh\n${body}\n`);
      chmodSync(mmdc, 0o755);
      return { PATH: `${bin}:${process.env.PATH ?? ""}` };
    }

    test("without mmdc the block is reported as not checked (info)", () => {
      writeFileSync(join(dir, "a.md"), block);
      // A PATH holding only symlinks to python3 and git, so no mmdc can be found on this host.
      const bin = join(dir, "bin-no-mmdc");
      mkdirSync(bin);
      const python = Bun.spawnSync(["python3", "-c", "import sys;print(sys.executable)"], {
        stdout: "pipe",
      })
        .stdout.toString()
        .trim();
      symlinkSync(python, join(bin, "python3"));
      symlinkSync(Bun.which("git") as string, join(bin, "git"));
      const result = run(dir, ["a.md"], { PATH: bin });
      expect(codes(result.findings)).toContain("mermaid-not-checked");
      expect(result.code).toBe(0);
    });

    test("a syntax failure from mmdc is an error", () => {
      writeFileSync(join(dir, "a.md"), block);
      const env = withFakeMmdc('echo "Parse error on line 2: Expecting SEMI" >&2; exit 1');
      const result = run(dir, ["a.md"], env);
      expect(result.code).toBe(1);
      expect(codes(result.findings)).toContain("mermaid-syntax");
    });

    test("mmdc failing to launch its browser is a warning, not a syntax error", () => {
      writeFileSync(join(dir, "a.md"), block);
      const env = withFakeMmdc('echo "Failed to launch the browser process!" >&2; exit 1');
      const result = run(dir, ["a.md"], env);
      expect(result.code).toBe(0);
      expect(codes(result.findings)).toContain("mermaid-unavailable");
      expect(codes(result.findings)).not.toContain("mermaid-syntax");
    });

    test("a missing node behind mmdc is an environment warning, not a syntax error", () => {
      writeFileSync(join(dir, "a.md"), block);
      const env = withFakeMmdc('echo "env: node: No such file or directory" >&2; exit 127');
      const result = run(dir, ["a.md"], env);
      expect(result.code).toBe(0);
      expect(codes(result.findings)).toContain("mermaid-unavailable");
    });

    test("a clean mmdc run produces no mermaid finding", () => {
      writeFileSync(join(dir, "a.md"), block);
      const env = withFakeMmdc("exit 0");
      expect(run(dir, ["a.md"], env).findings).toEqual([]);
    });
  });

  test("directories are walked; missing paths exit 2 with a message", () => {
    mkdirSync(join(dir, "docs"));
    writeFileSync(join(dir, "docs", "a.md"), "# A [verified]\n\n[bad](nope.md)\n");
    const walked = run(dir, ["docs"]);
    expect(walked.code).toBe(1);
    expect(walked.findings.length).toBe(1);
    expect(walked.findings[0].code).toBe("broken-link");
    expect(walked.findings[0].path).toContain(join("docs", "a.md"));
    const missing = run(dir, ["nope.md"]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("no such path");
  });
});
