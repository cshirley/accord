import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
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

const PRIOR_LOG_BULLET =
  "* **Update**: ASDLC-1 commit-evidence: [Commit message format](/references/commit-format.md) (commit guard rules), [Evidence stack](/architecture/evidence-stack.md) (`stack.commits` phase mode) and [accord CLI](/references/accord-cli.md) (`accord evidence`) now describe the implemented behaviour.";

describe("ASDLC-1/AC-31 docs validation (ASDLC-1/TC-32)", () => {
  it("ASDLC-1/AC-31 validate:okf exits 0", () => {
    const { code, out } = run("validate:okf");
    expect({ code, out: code === 0 ? "" : out }).toEqual({ code: 0, out: "" });
  }, 120_000);

  it("ASDLC-1/AC-31 validate:ste exits 0", () => {
    const { code, out } = run("validate:ste");
    expect({ code, out: code === 0 ? "" : out }).toEqual({ code: 0, out: "" });
  }, 120_000);

  it("ASDLC-1/AC-31 check:biome exits 0 on the files this task changes (gitignored and harness-generated state excluded)", () => {
    // Scoped to task-17 files: docs/dev/<ID>/trace.json is harness-generated and unrelated.
    const files = [
      "packages/accord-core/schemas/accord-schema.json",
      "packages/accord-core/tests/alignment.test.ts",
      "packages/accord-core/tests/docs-validation.test.ts",
    ];
    for (const file of files) expect(existsSync(join(ROOT, file))).toBe(true);
    const proc = Bun.spawnSync(["bunx", "biome", "check", ...files], {
      cwd: ROOT,
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = `${proc.stdout.toString()}${proc.stderr.toString()}`;
    expect({ code: proc.exitCode, out: proc.exitCode === 0 ? "" : out }).toEqual({
      code: 0,
      out: "",
    });
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
  // ASDLC-1/AC-31 (task 14): evidence asset documentation.
  it("ASDLC-1/AC-31 evidence-stack.md documents the evidence asset, evidence(task-<N>) commit, qualified refs and squash survival", () => {
    const text = read("okf/architecture/evidence-stack.md");
    expect(text).toContain("docs/dev/<ID>/evidence/task-<N>.{md,json}");
    expect(text).toContain("evidence(task-<N>)");
    expect(text).toContain("<ID>/AC-<n>");
    expect(text).toContain("resource: /packages/accord-core/src/evidence/asset.ts");
    expect(text).toContain("resource: /packages/accord-core/src/commit/evidence-commit.ts");
    const status = text.split("\n").find((l) => /^\*\*(Partly )?[Ii]mplemented/.test(l));
    expect(status).toBeDefined();
    expect(status).toContain("evidence(task-<N>)");
    expect(status).toMatch(/evidence asset/i);
    const traceLine = text
      .split("\n")
      .find((l) => l.includes("trace.json") && l.includes("<ID>/AC-<n>"));
    expect(traceLine).toBeDefined();
    expect(traceLine).toContain("stack.enabled");
    expect(text).toMatch(/evidence asset[^\n]*(survives|survive)|(survives|survive)[^\n]*squash/i);
  });

  it("ASDLC-1/AC-31 artifacts-and-state.md lists the evidence asset in the Committed table", () => {
    const text = read("okf/references/artifacts-and-state.md");
    const lines = text.split("\n");
    const rowIndex = lines.findIndex((line) =>
      /^\|\s*`evidence\/task-<N>\.\{md,\s*json\}`/.test(line),
    );
    expect(rowIndex).toBeGreaterThan(-1);
    const committed = lines.findIndex((l) => l.startsWith("# Committed"));
    const transient = lines.findIndex((l) => l.startsWith("# Transient"));
    expect(rowIndex).toBeGreaterThan(committed);
    expect(rowIndex).toBeLessThan(transient);
    const row = lines[rowIndex] ?? "";
    expect(row).toContain("evidence(task-<N>)");
    expect(row).toContain("<ID>/AC-<n>");
    expect(row).toMatch(/survives?[^|]*squash|squash[^|]*survives?/i);
    expect(text).toContain("resource: /packages/accord-core/src/evidence/asset.ts");
    const paragraph = lines.find((l) => l.startsWith("Each `done` task gets a harness commit"));
    expect(paragraph).toBeDefined();
    const paragraphIndex = lines.indexOf(paragraph ?? "");
    expect(lines.slice(paragraphIndex, paragraphIndex + 3).join("\n")).toContain(
      "evidence(task-<N>)",
    );
  });

  it("ASDLC-1/AC-31 artifacts-and-state.md says trace.json uses qualified <ID>/AC-<n> refs only when stack.enabled", () => {
    const traceRow = read("okf/references/artifacts-and-state.md")
      .split("\n")
      .find((l) => /^\|\s*`trace\.json`/.test(l));
    expect(traceRow).toBeDefined();
    expect(traceRow).toContain("<ID>/AC-<n>");
    expect(traceRow).toContain("stack.enabled");
  });

  it("ASDLC-1/AC-31 okf/log.md has a dated entry for the evidence asset docs", () => {
    const matching = datedBullets().filter(
      (bullet) =>
        bullet.text.includes("ASDLC-1") &&
        bullet.text.includes("/references/artifacts-and-state.md") &&
        bullet.text.includes("/architecture/evidence-stack.md") &&
        bullet.text !== PRIOR_LOG_BULLET &&
        bullet.text.includes("evidence/task-<N>") &&
        new Date(`${bullet.date}T00:00:00Z`).toISOString().slice(0, 10) === bullet.date,
    );
    expect(datedBullets()).toContainEqual({ date: "2026-10-30", text: PRIOR_LOG_BULLET });
    expect(matching.length).toBeGreaterThanOrEqual(1);
  });

  // ASDLC-1/AC-31 (task 17): security gate documentation.
  const reviewLoopSection = (): string => {
    const text = read("okf/references/orchestration-policy.md");
    const start = text.indexOf("# review_loop");
    const end = text.indexOf("# quick_fix_loop");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return text.slice(start, end);
  };

  it("ASDLC-1/AC-31 orchestration-policy.md documents the review-security gate, not 'always advisory'", () => {
    const whole = read("okf/references/orchestration-policy.md");
    expect(whole).not.toMatch(/always advisory/i);
    expect(whole).not.toMatch(/recorded, briefed, never gate/i);
    const rows = reviewLoopSection()
      .split("\n")
      .filter((line) => /^\|\s*`review_security(\.severity_gate)?`/.test(line));
    expect(rows.length).toBe(1);
    const row = rows[0] ?? "";
    for (const token of [
      "`advisory`",
      "`warn`",
      "`block`",
      "`none`",
      "stack.enabled",
      "code_review",
    ])
      expect(row).toContain(token);
    expect(row).toMatch(/effective default[^|]*`warn`/);
    expect(row).not.toContain("max_retries");
    // the per-loop override row must not claim review_security
    const overrideRow = reviewLoopSection()
      .split("\n")
      .find((line) => /^\|\s*`review_test`/.test(line));
    expect(overrideRow).toBeDefined();
    expect(overrideRow).not.toContain("review_security");
  });

  it("ASDLC-1/AC-31 stack-config.md security gate section is no longer marked proposed", () => {
    const text = read("okf/references/stack-config.md");
    expect(text).toMatch(/^# Related: security gate\s*$/m);
    const section = text.slice(text.search(/^# Related: security gate/m));
    expect(section).not.toMatch(/proposed|not (yet )?read/i);
    expect(section).toContain("orchestration.review_loop.review_security.severity_gate");
    expect(section).toMatch(/Schema default is `advisory`/);
    expect(section).toMatch(/effective default is `warn`/);
    expect(text).toContain(
      "resource: /packages/accord-core/src/orchestration/post-result/review-security.ts",
    );
    // intro must not claim the whole key set is unread without noting the gate
    expect(text).not.toMatch(/The harness does not read it yet\.(?![^\n]*security gate)/);
  });

  // Plan gap: these concepts are outside plan task 17 files[] but still say review-security never gates.
  it.each([
    "okf/architecture/agents.md",
    "okf/architecture/crucible-verification.md",
    "okf/references/task-file.md",
  ])("ASDLC-1/AC-31 %s does not say review-security never gates", (file) => {
    const text = read(file);
    expect(text).not.toMatch(
      /review-security[^\n]*(never (gate|block)|always advisory)|all review-security findings are `advisory`/i,
    );
    for (const line of text.split("\n")) {
      if (/review-security/i.test(line) && /advisory/i.test(line))
        expect(line).toMatch(/severity_gate|stack-config|gate/i);
    }
  });

  it("ASDLC-1/AC-31 okf/log.md has a dated entry for the security gate docs", () => {
    const EVIDENCE_ASSET_BULLET =
      "* **Update**: ASDLC-1 evidence-asset: [Evidence stack](/architecture/evidence-stack.md) and [Artifacts and state](/references/artifacts-and-state.md) (`/references/artifacts-and-state.md`) now describe `evidence/task-<N>.{md,json}`, the `evidence(task-<N>)` commit, qualified `<ID>/AC-<n>` refs and squash survival.";
    expect(datedBullets()).toContainEqual({ date: "2026-10-30", text: PRIOR_LOG_BULLET });
    expect(datedBullets().map((bullet) => bullet.text)).toContain(EVIDENCE_ASSET_BULLET);
    const matching = datedBullets().filter(
      (bullet) =>
        bullet.text.includes("ASDLC-1") &&
        bullet.text.includes("security-gate") &&
        bullet.text.includes("/references/orchestration-policy.md") &&
        bullet.text.includes("/references/stack-config.md") &&
        bullet.text !== PRIOR_LOG_BULLET &&
        bullet.text !== EVIDENCE_ASSET_BULLET &&
        !bullet.text.includes("evidence/task-<N>") &&
        !bullet.text.includes("accord evidence") &&
        new Date(`${bullet.date}T00:00:00Z`).toISOString().slice(0, 10) === bullet.date,
    );
    expect(matching.length).toBeGreaterThanOrEqual(1);
  });

  // ASDLC-1/AC-31 (task 20): pre-write lock guard documentation.
  it("ASDLC-1/AC-31 hooks.md has exactly one Hook-table row for the pre-write lock guard", () => {
    const rows = read("okf/architecture/hooks.md")
      .split("\n")
      .filter(
        (line) =>
          /^\|/.test(line) &&
          line.includes("tool_call") &&
          line.includes("write") &&
          line.includes("edit") &&
          line.includes("contract.lock.json") &&
          line.includes("contract-amend"),
      );
    expect(rows.length).toBe(1);
  });

  it("ASDLC-1/AC-31 hooks.md sources the lock guard module", () => {
    expect(read("okf/architecture/hooks.md")).toContain(
      "resource: /packages/accord-core/src/contract/lock-guard.ts",
    );
  });

  it("ASDLC-1/AC-31 okf/log.md has a dated entry for the lock guard docs", () => {
    const EVIDENCE_ASSET_BULLET =
      "* **Update**: ASDLC-1 evidence-asset: [Evidence stack](/architecture/evidence-stack.md) and [Artifacts and state](/references/artifacts-and-state.md) (`/references/artifacts-and-state.md`) now describe `evidence/task-<N>.{md,json}`, the `evidence(task-<N>)` commit, qualified `<ID>/AC-<n>` refs and squash survival.";
    const matching = datedBullets().filter(
      (bullet) =>
        bullet.text.includes("ASDLC-1") &&
        bullet.text.includes("/architecture/hooks.md") &&
        /lock guard|contract-lock/i.test(bullet.text) &&
        bullet.text !== PRIOR_LOG_BULLET &&
        bullet.text !== EVIDENCE_ASSET_BULLET &&
        !bullet.text.includes("security-gate") &&
        !bullet.text.includes("evidence/task-<N>") &&
        new Date(`${bullet.date}T00:00:00Z`).toISOString().slice(0, 10) === bullet.date,
    );
    expect(matching.length).toBeGreaterThanOrEqual(1);
  });
});
