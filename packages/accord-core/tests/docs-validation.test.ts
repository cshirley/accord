import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");

function run(script: string): { code: number | null; out: string } {
  const proc = Bun.spawnSync(["bun", "run", script], { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  return { code: proc.exitCode, out: `${proc.stdout.toString()}${proc.stderr.toString()}` };
}

/** Bullets under dated `## YYYY-MM-DD` headings of okf/log.md. */
function datedBullets(): { date: string; text: string }[] {
  const result: { date: string; text: string }[] = [];
  let date: string | null = null;
  for (const line of read("okf/log.md").split("\n")) {
    const heading = /^## (\d{4}-\d{2}-\d{2})\s*$/.exec(line);
    if (heading) {
      date = heading[1] ?? null;
      continue;
    }
    if (date && line.startsWith("* ")) result.push({ date, text: line });
  }
  return result;
}

describe("ASDLC-1/AC-31 docs validation (ASDLC-1/TC-32)", () => {
  it("ASDLC-1/AC-31 validate:okf exits 0", () => {
    const { code, out } = run("validate:okf");
    expect({ code, out: code === 0 ? "" : out }).toEqual({ code: 0, out: "" });
  }, 120_000);

  it("ASDLC-1/AC-31 validate:ste exits 0", () => {
    const { code, out } = run("validate:ste");
    expect({ code, out: code === 0 ? "" : out }).toEqual({ code: 0, out: "" });
  }, 120_000);

  it("ASDLC-1/AC-31 check:biome exits 0", () => {
    const { code, out } = run("check:biome");
    expect({ code, out: code === 0 ? "" : out }).toEqual({ code: 0, out: "" });
  }, 120_000);

  it("ASDLC-1/AC-31 okf/log.md has a dated entry naming ASDLC-1, the evidence command and the updated concepts", () => {
    const matching = datedBullets().filter(
      (bullet) =>
        bullet.text.includes("ASDLC-1") &&
        bullet.text.includes("accord evidence") &&
        bullet.text.includes("/references/commit-format.md") &&
        bullet.text.includes("/architecture/evidence-stack.md") &&
        bullet.text.includes("/references/accord-cli.md") &&
        new Date(`${bullet.date}T00:00:00Z`).toISOString().slice(0, 10) === bullet.date,
    );
    expect(matching.length).toBeGreaterThanOrEqual(1);
  });

  it("ASDLC-1/AC-31 accord-cli.md has an evidence Commands row with real syntax", () => {
    const row = read("okf/references/accord-cli.md")
      .split("\n")
      .find((line) => /^\|\s*`evidence <ID>/.test(line));
    expect(row).toBeDefined();
    expect(row).toMatch(/task-<N>/);
    expect(row).toMatch(/--format/);
    expect(row).toMatch(/md\\?\|tsv/);
  });

  it("ASDLC-1/AC-31 evidence-stack.md documents the implemented stack.commits phase mode", () => {
    const text = read("okf/architecture/evidence-stack.md");
    expect(text).toMatch(
      /`stack\.commits`\s*(?:is|=|:)\s*`?"?phase"?`?|`stack\.commits:\s*"?phase"?`/,
    );
    expect(text).not.toMatch(/^\*\*Proposed, not yet implemented\.\*\*/m);
    expect(text).toContain("resource: /packages/accord-core/src/commit/phase-commit.ts");
  });

  it("ASDLC-1/AC-31 commit-format.md is bound to the implemented commit code", () => {
    const text = read("okf/references/commit-format.md");
    expect(text).toContain("resource: /packages/accord-core/src/commit/commit-grammar.ts");
    expect(text).toContain("resource: /packages/accord-core/src/commit/commit-guard.ts");
    for (const rule of ["code-touches-test", "reviews-only", "trailer-counts", "agent-commit"]) {
      expect(text).toContain(rule);
    }
    expect(text).not.toMatch(/^\*\*Proposed\.\*\*/m);
  });
});
