import { afterEach, describe, expect, it } from "bun:test";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateFeatureIndex } from "../src/knowledge/index-gen.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "features");
const SCRIPT = join(ROOT, "scripts", "validate-features.ts");
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Copy of the fixtures (the script regenerates index files, so never run on the originals). */
function fixtureCopy(): string {
  const dir = mkdtempSync(join(tmpdir(), "validate-features-"));
  tmpDirs.push(dir);
  cpSync(FIXTURES, dir, { recursive: true });
  return dir;
}

function run(args: string[], cwd = ROOT): { code: number | null; out: string } {
  const proc = Bun.spawnSync(["bun", SCRIPT, ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  return { code: proc.exitCode, out: `${proc.stdout.toString()}${proc.stderr.toString()}` };
}

// TC-19: this file covers the CLI wiring; library behaviour is in feature-docs.test.ts.
const ALL_CODES = [
  "broken-anchor",
  "broken-link",
  "ac-without-test",
  "unresolved-test",
  "too-many-acs",
];

function harnessMd(knowledge: Record<string, unknown>): string {
  const harness = {
    schema_version: "1.0",
    language: "typescript",
    test: { command: "bun test" },
    verification_commands: ["bun test"],
    knowledge,
  };
  return `# Repo\n\n## Dev Harness\n\n\`\`\`json\n${JSON.stringify(harness)}\n\`\`\`\n`;
}

const idsOf = (file: string): string[] =>
  JSON.parse(readFileSync(file, "utf8")).features.map((f: { id: string }) => f.id);

describe("ASDLC-1/AC-18 validate:features CLI (ASDLC-1/TC-19)", () => {
  it.each([
    ["broken-anchor", "broken-anchor", "src/auth/missing.ts"],
    ["broken-link", "broken-link", "does-not-exist.md"],
    ["ac-without-test", "ac-without-test", "feat-one.AC1"],
    ["bad-test-file", "unresolved-test", "verify/nope.proof.ts"],
    ["bad-test-name", "unresolved-test", "no_such_case"],
  ])("ASDLC-1/AC-18 fixture %s reports only %s", (fixture, code, token) => {
    const copy = fixtureCopy();
    const { code: exit, out } = run(["--root", join(copy, fixture)]);
    expect(exit).toBe(1);
    expect(out).toContain(code);
    expect(out).toContain("feat-one");
    expect(out).toContain(token);
    for (const other of ALL_CODES.filter((c) => c !== code)) expect(out).not.toContain(other);
    expect(out).not.toMatch(/auth-token-refresh|session-store/);
  });

  it("ASDLC-1/AC-18 exits 0 on the valid fixture and regenerates stale index.md and index.json", () => {
    const root = fixtureCopy();
    const valid = join(root, "valid");
    const dir = join(valid, "docs", "features");
    writeFileSync(join(dir, "index.json"), '{"features":[{"id":"stale"}]}\n');
    writeFileSync(join(dir, "index.md"), "stale\n");
    const { code, out } = run(["--root", valid]);
    expect({ code, out: code === 0 ? "" : out }).toEqual({ code: 0, out: "" });
    expect(idsOf(join(dir, "index.json"))).toEqual(["auth-token-refresh", "session-store"]);
    const md = readFileSync(join(dir, "index.md"), "utf8");
    expect(md).toContain("auth-token-refresh");
    expect(md).toContain("session-store");
    expect(md).not.toContain("stale");
    // F-012: output equals the accord-core generator byte for byte (CLI stays thin).
    const reference = join(fixtureCopy(), "valid");
    const expected = generateFeatureIndex({ repoRoot: reference });
    expect(readFileSync(join(dir, "index.json"), "utf8")).toBe(expected.indexJson);
    expect(md).toBe(expected.indexMd);
  });

  it("ASDLC-1/AC-18 creates index files when absent", () => {
    const valid = join(fixtureCopy(), "valid");
    expect(existsSync(join(valid, "docs", "features", "index.json"))).toBe(false);
    expect(run(["--root", valid]).code).toBe(0);
    expect(existsSync(join(valid, "docs", "features", "index.json"))).toBe(true);
    expect(existsSync(join(valid, "docs", "features", "index.md"))).toBe(true);
  });

  it("ASDLC-1/AC-18 reports too-many-acs once max_acs_per_feature is configured below the AC count", () => {
    const temp = join(fixtureCopy(), "oversized");
    writeFileSync(join(temp, "AGENTS.md"), harnessMd({ enabled: true, max_acs_per_feature: 2 }));
    const { code, out } = run([], temp);
    expect(code).toBe(1);
    expect(out).toContain("too-many-acs");
    expect(out).toContain("big-feature");
    for (const other of ALL_CODES.filter((c) => c !== "too-many-acs"))
      expect(out).not.toContain(other);
  });

  it("ASDLC-1/AC-18 default max_acs_per_feature is not a low hardcoded number (3 ACs pass)", () => {
    const { code, out } = run(["--root", join(fixtureCopy(), "oversized")]);
    expect({ code, out: code === 0 ? "" : out }).toEqual({ code: 0, out: "" });
  });

  it.each([12, 13])("ASDLC-1/AC-18 default max_acs_per_feature 12 with %i ACs", (count) => {
    const dir = join(fixtureCopy(), "oversized");
    const acs = Array.from(
      { length: count },
      (_, n) =>
        `  - { id: big-feature.AC${n + 1}, text: "ac", tests: ["verify/refresh.proof.ts#expired"] }`,
    ).join("\n");
    const file = join(dir, "docs", "features", "big-feature.md");
    writeFileSync(
      file,
      readFileSync(file, "utf8").replace(/acs:\n( {2}- \{[^\n]*\n)+/, `acs:\n${acs}\n`),
    );
    const { code, out } = run(["--root", dir]);
    if (count === 12) {
      expect({ code, out: code === 0 ? "" : out }).toEqual({ code: 0, out: "" });
      return;
    }
    expect(code).toBe(1);
    expect(out).toContain("too-many-acs");
    expect(out).toContain("big-feature");
    for (const other of ALL_CODES.filter((c) => c !== "too-many-acs"))
      expect(out).not.toContain(other);
  });

  it("ASDLC-1/AC-18 reports every defect across a multi-defect tree", () => {
    const root = fixtureCopy();
    const dir = join(root, "broken-anchor");
    const featuresDir = join(dir, "docs", "features");
    const fromFixture = (fixture: string, id: string): string =>
      readFileSync(join(root, fixture, "docs", "features", "feat-one.md"), "utf8")
        .replaceAll("id: feat-one", `id: ${id}`)
        .replaceAll("feat-one.AC1", `${id}.AC1`);
    writeFileSync(join(featuresDir, "feat-two.md"), fromFixture("broken-link", "feat-two"));
    writeFileSync(join(featuresDir, "feat-three.md"), fromFixture("ac-without-test", "feat-three"));
    const { code, out } = run(["--root", dir]);
    expect(code).toBe(1);
    for (const token of [
      "broken-anchor",
      "src/auth/missing.ts",
      "broken-link",
      "does-not-exist.md",
      "ac-without-test",
      "feat-three.AC1",
      "feat-two",
      "feat-three",
    ])
      expect(out).toContain(token);
  });

  it("ASDLC-1/AC-18 validates feature docs under a configured knowledge.root", () => {
    const temp = join(fixtureCopy(), "broken-anchor");
    renameSync(join(temp, "docs", "features"), join(temp, "kb-tmp"));
    mkdirSync(join(temp, "kb"), { recursive: true });
    renameSync(join(temp, "kb-tmp"), join(temp, "kb", "features"));
    writeFileSync(join(temp, "AGENTS.md"), harnessMd({ enabled: true, root: "kb/features" }));
    const { code, out } = run([], temp);
    expect(code).toBe(1);
    expect(out).toContain("broken-anchor");
    expect(out).toContain("feat-one");
    expect(out).toContain("src/auth/missing.ts");
  });

  it("ASDLC-1/AC-18 regenerates the index under a configured knowledge.root, not docs/features", () => {
    const temp = join(fixtureCopy(), "valid");
    mkdirSync(join(temp, "kb"), { recursive: true });
    renameSync(join(temp, "docs", "features"), join(temp, "kb", "features"));
    writeFileSync(join(temp, "AGENTS.md"), harnessMd({ enabled: true, root: "kb/features" }));
    const { code, out } = run([], temp);
    expect({ code, out: code === 0 ? "" : out }).toEqual({ code: 0, out: "" });
    expect(idsOf(join(temp, "kb", "features", "index.json"))).toEqual([
      "auth-token-refresh",
      "session-store",
    ]);
    expect(existsSync(join(temp, "kb", "features", "index.md"))).toBe(true);
    expect(existsSync(join(temp, "docs", "features"))).toBe(false);
  });

  it("ASDLC-1/AC-18 on this repo (no knowledge.root configured) exits 0 and creates no docs/features", () => {
    const target = join(ROOT, "docs", "features");
    const existed = existsSync(target);
    try {
      expect(existed).toBe(false);
      const { code, out } = run([]);
      expect({ code, out: code === 0 ? "" : out }).toEqual({ code: 0, out: "" });
      expect(existsSync(target)).toBe(false);
    } finally {
      if (!existed) rmSync(target, { recursive: true, force: true });
    }
  });
});

describe("ASDLC-1/AC-18 validate:features wiring", () => {
  it("ASDLC-1/AC-18 package.json has validate:features and check runs it", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["validate:features"]).toBe("bun scripts/validate-features.ts");
    expect(pkg.scripts.check).toContain("npm run validate:features");
  });

  it("ASDLC-1/AC-18 AGENTS.md Dev Harness lists validate:features in lint and verification_commands", () => {
    const text = read("AGENTS.md");
    const json = /## Dev Harness[\s\S]*?```json\n([\s\S]*?)\n```/.exec(text)?.[1] ?? "";
    const harness = JSON.parse(json) as { lint: string; verification_commands: string[] };
    expect(harness.lint).toContain("bun run validate:features");
    expect(harness.verification_commands).toContain("bun run validate:features");
  });
});

describe("ASDLC-1/AC-31 validate:features docs", () => {
  it("ASDLC-1/AC-31 verify-a-change.md documents validate:features", () => {
    const row = read("okf/playbooks/verify-a-change.md")
      .split("\n")
      .find((line) => line.startsWith("| `bun run validate:features`"));
    expect(row).toBeDefined();
    const checks = (row ?? "").split("|")[2]?.trim() ?? "";
    expect(checks).toMatch(/anchor|link|test|index|max_acs/i);
  });

  it("ASDLC-1/AC-31 okf/log.md appends a dated feature-knowledge entry naming validate:features", () => {
    const lines = read("okf/log.md").split("\n");
    const datedBullets: { date: string; text: string }[] = [];
    const headings: string[] = [];
    let date: string | null = null;
    for (const line of lines) {
      const heading = /^## (\d{4}-\d{2}-\d{2})\s*$/.exec(line);
      if (heading) {
        date = heading[1] ?? null;
        headings.push(date ?? "");
      } else if (date && line.startsWith("* ")) datedBullets.push({ date, text: line });
    }
    // The previous last entry stays byte-identical (append-only).
    expect(datedBullets).toContainEqual({
      date: "2026-11-03",
      text: "* **Update**: ASDLC-1 trunk-hardening: [Evidence stack](/architecture/evidence-stack.md) (depth cap, `require_flag`, overrun, bottom-up merge), [Orchestration policy](/references/orchestration-policy.md) (`stack.sizing.max_depth`, `stack.require_flag`, overrun and merge order), [Answer pending decisions](/playbooks/answer-decisions.md) (`overrun-task-<N>` options), [Stack configuration](/references/stack-config.md) (`require_flag`, `merge_strategy`) and [Artifacts and state](/references/artifacts-and-state.md) (`trace.json` size fields) now describe the implemented trunk-hardening.",
    });
    const lastHeading = headings[headings.length - 1] ?? "";
    expect(new Date(`${lastHeading}T00:00:00Z`).toISOString().slice(0, 10)).toBe(lastHeading);
    expect(lastHeading >= "2026-11-03").toBe(true);
    const matches = datedBullets.filter(
      (b) =>
        b.date === lastHeading &&
        b.text.includes("ASDLC-1") &&
        b.text.includes("feature-knowledge") &&
        !b.text.includes("trunk-hardening") &&
        b.text.includes("validate:features") &&
        b.text.includes("/playbooks/verify-a-change.md"),
    );
    expect(matches.length).toBe(1);
  });
});
