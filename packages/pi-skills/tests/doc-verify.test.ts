import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "..", "skills", "doc-verify", "scripts", "doc-verify.py");

type Finding = { code: string; level: string; line: number };

function git(cwd: string, args: string[]): string {
  const proc = Bun.spawnSync(["git", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" },
  });
  return proc.stdout.toString().trim();
}

function run(cwd: string, args: string[]): { code: number; findings: Finding[] } {
  const proc = Bun.spawnSync(["python3", script, "--json", "--today", "2026-10-29", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const text = proc.stdout.toString();
  return { code: proc.exitCode ?? -1, findings: text ? (JSON.parse(text) as Finding[]) : [] };
}

const codes = (findings: Finding[]) => findings.map((f) => f.code);

describe("doc-verify.py", () => {
  let dir = "";

  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), "docv-")));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test("clean doc passes", () => {
    writeFileSync(join(dir, "a.md"), "# A\n\nFact [verified] about things.\n");
    const result = run(dir, ["a.md"]);
    expect(result.code).toBe(0);
    expect(codes(result.findings)).toEqual([]);
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
    expect(run(dir, ["a.md"]).findings).toEqual([]);
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

  test("verified-against: unknown sha errors; changed paths are stale evidence", () => {
    git(dir, ["init", "-q"]);
    git(dir, ["config", "user.email", "t@example.com"]);
    git(dir, ["config", "user.name", "t"]);
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "x.ts"), "1\n");
    git(dir, ["add", "."]);
    git(dir, ["commit", "-qm", "one"]);
    const sha = git(dir, ["rev-parse", "HEAD"]);
    writeFileSync(
      join(dir, "doc.md"),
      `---\nverified-against: ${sha}\nverified-paths: [src]\n---\n# D [verified]\n`,
    );
    expect(run(dir, ["doc.md"]).code).toBe(0);

    writeFileSync(join(dir, "src", "x.ts"), "2\n");
    git(dir, ["commit", "-qam", "two"]);
    const stale = run(dir, ["doc.md"]);
    expect(stale.code).toBe(1);
    expect(codes(stale.findings)).toContain("stale-evidence");

    writeFileSync(
      join(dir, "bad.md"),
      "---\nverified-against: 0000000000000000000000000000000000000000\n---\n# D [verified]\n",
    );
    expect(codes(run(dir, ["bad.md"]).findings)).toContain("verified-against");
  });

  test("directories are walked; missing paths exit 2", () => {
    mkdirSync(join(dir, "docs"));
    writeFileSync(join(dir, "docs", "a.md"), "# A [verified]\n\n[bad](nope.md)\n");
    expect(run(dir, ["docs"]).code).toBe(1);
    expect(run(dir, ["nope.md"]).code).toBe(2);
  });
});
