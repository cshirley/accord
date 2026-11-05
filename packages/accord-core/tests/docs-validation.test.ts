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

  // ASDLC-1/AC-31 (task 24): contract PR0 and contract-amend documentation.
  it("ASDLC-1/AC-31 evidence-stack.md documents PR0, the lock file, the contract tag and amend-spec as contract-amend", () => {
    const text = read("okf/architecture/evidence-stack.md");
    expect(text).toContain("PR0");
    expect(text).toContain("contract.lock.json");
    expect(text).toContain("accord/<ID>/contract");
    expect(text).toContain("/dev amend-spec");
    expect(text).toContain("contract-amend");
    expect(text).toMatch(/outcome=amend/);
    expect(text).toContain("resource: /packages/accord-core/src/contract/");
  });

  it("ASDLC-1/AC-31 evidence-stack.md says the lock covers brief.md, spec.json and plan.json but not state/work-item.json", () => {
    const text = read("okf/architecture/evidence-stack.md");
    const line = text.split("\n").find((l) => /lock/i.test(l) && /state\/work-item\.json/.test(l));
    expect(line).toBeDefined();
    for (const name of ["brief.md", "spec.json", "plan.json"]) expect(line).toContain(name);
    expect(line).toMatch(/not|no |exclud/i);
  });

  it("ASDLC-1/AC-31 artifacts-and-state.md documents contract.lock.json, the contract tag and amend", () => {
    const text = read("okf/references/artifacts-and-state.md");
    expect(text).toContain("contract.lock.json");
    expect(text).toContain("accord/<ID>/contract");
    expect(text).toContain("contract-amend");
    expect(text).toContain("sha256");
  });

  it("ASDLC-1/AC-31 dev-command.md amend-spec row mentions the contract-amend and its flags", () => {
    const row = read("okf/references/dev-command.md")
      .split("\n")
      .find((l) => /^\|\s*`\/dev amend-spec/.test(l));
    expect(row).toBeDefined();
    expect(row).toContain("contract-amend");
    expect(row).toContain("--replan");
    expect(row).toContain("--cancel");
    expect(row).toContain("<reason>");
  });

  it("ASDLC-1/AC-31 okf/log.md has a dated entry for the contract PR0 and amendment docs", () => {
    const matching = datedBullets().filter(
      (bullet) =>
        bullet.text.includes("ASDLC-1") &&
        bullet.text.includes("contract-lock") &&
        bullet.text.includes("/architecture/evidence-stack.md") &&
        bullet.text.includes("/references/artifacts-and-state.md") &&
        bullet.text.includes("/references/dev-command.md") &&
        /amend/i.test(bullet.text) &&
        new Date(`${bullet.date}T00:00:00Z`).toISOString().slice(0, 10) === bullet.date,
    );
    expect(matching.length).toBeGreaterThanOrEqual(1);
  });
});

// ASDLC-1/AC-31 (task 32): stack-compute documentation and log entry.
const EXISTING_2026_10_30 = [
  "* **Update**: ASDLC-1 stack-compute: [accord CLI](/references/accord-cli.md) (`/references/accord-cli.md`) now lists `accord stack [sync|submit|report] <ID>`, a thin adapter over `stack/service.ts`.",
  "* **Update**: ASDLC-1 contract-lock: [Evidence stack](/architecture/evidence-stack.md), [Artifacts and state](/references/artifacts-and-state.md) and [/dev command](/references/dev-command.md) now describe contract PR0, `contract.lock.json`, the `accord/<ID>/contract` tag and `/dev amend-spec` as a contract-amend.",
  "* **Update**: ASDLC-1 security-gate: [Orchestration policy](/references/orchestration-policy.md) and [Stack configuration](/references/stack-config.md) (`/references/stack-config.md`) now describe the review-security gate (`review_loop.review_security.severity_gate`); agents, crucible-verification and task-file concepts no longer say it never gates.",
  "* **Update**: ASDLC-1 evidence-asset: [Evidence stack](/architecture/evidence-stack.md) and [Artifacts and state](/references/artifacts-and-state.md) (`/references/artifacts-and-state.md`) now describe `evidence/task-<N>.{md,json}`, the `evidence(task-<N>)` commit, qualified `<ID>/AC-<n>` refs and squash survival.",
  "* **Update**: ASDLC-1 commit-evidence: [Commit message format](/references/commit-format.md) (commit guard rules), [Evidence stack](/architecture/evidence-stack.md) (`stack.commits` phase mode) and [accord CLI](/references/accord-cli.md) (`accord evidence`) now describe the implemented behaviour.",
  "* **Update**: ASDLC-1 contract-lock: [Lifecycle hooks](/architecture/hooks.md) now lists the pre-write lock guard (`tool_call` write/edit blocked for locked contract files unless a contract-amend is open).",
];

const sectionOf = (text: string, heading: string): string => {
  const start = text.indexOf(`\n# ${heading}`);
  if (start < 0) return "";
  const next = text.indexOf("\n# ", start + 1);
  return text.slice(start, next < 0 ? undefined : next);
};
describe("ASDLC-1/AC-31 stack-compute docs (task 32)", () => {
  it("ASDLC-1/AC-31 tool-surface.md documents the dev_stack tools", () => {
    const text = read("okf/architecture/tool-surface.md");
    for (const tool of ["dev_stack", "dev_stack_sync", "dev_stack_submit", "dev_stack_report"]) {
      expect(text).toMatch(new RegExp(`\`${tool}\``));
    }
    const row = text.split("\n").find((l) => /^\|/.test(l) && l.includes("`dev_stack`"));
    expect(row).toBeDefined();
    for (const tool of ["dev_stack", "dev_stack_sync", "dev_stack_submit", "dev_stack_report"]) {
      expect(row).toContain(`\`${tool}\``);
    }
    expect(text).toMatch(/dev_stack[^\n]*stack\.enabled|stack\.enabled[^\n]*dev_stack/);
  });

  it("ASDLC-1/AC-31 evidence-stack.md documents computeStack and the StackProvider port with source bindings", () => {
    const text = read("okf/architecture/evidence-stack.md");
    expect(text).toContain("`computeStack");
    expect(text).toContain("StackProvider");
    expect(text).toContain("resource: /packages/accord-core/src/stack/compute-stack.ts");
    expect(text).toContain("resource: /packages/accord-core/src/stack/provider.ts");
    expect(text).toMatch(/dev_stack/);
    const status = text.split("\n").find((l) => /^\*\*(Partly )?[Ii]mplemented/.test(l));
    expect(status).toBeDefined();
    expect(status).toMatch(/computeStack|stack compute|PR stack/i);
  });

  it("ASDLC-1/AC-31 stack-config.md no longer says the harness ignores the stack key and lists every sizing key", () => {
    const text = read("okf/references/stack-config.md");
    expect(text).not.toMatch(/The harness does not read it yet/);
    for (const key of [
      "max_pr_lines",
      "min_pr_lines",
      "max_files",
      "max_depth",
      "overrun_factor",
      "split_on",
      "merge_small_same_concern",
    ]) {
      expect(text).toContain(`\`${key}\``);
    }
    expect(text).toMatch(/dev_stack/);
    expect(text).toContain("resource: /packages/accord-core/src/stack/compute-stack.ts");
  });

  it("ASDLC-1/AC-31 evidence-stack.md no longer carries stale implementation claims", () => {
    const text = read("okf/architecture/evidence-stack.md");
    expect(text).not.toContain("computeStack(plan, config)");
    const sizing = sectionOf(text, "Sizing");
    expect(sizing).toContain("`max_pr_lines`");
    expect(sizing).toContain("`max_files`");
    expect(sizing).toMatch(/(`split_on`|package|interface)[^.]*(not yet|proposed|planned|later)/i);
    expect(sizing).toMatch(/overrun_factor[^.]*(checkOverrun|after GREEN)/);
    expect(sizing).not.toMatch(/overrun_factor[^.]*(not yet|proposed|planned)/i);
    expect(sectionOf(text, "Layering")).not.toMatch(/only `gh` is planned first/);
    const status = text.split("\n").find((l) => /^\*\*(Partly )?[Ii]mplemented/.test(l));
    expect(status).toMatch(/^\*\*Partly implemented/);
  });

  it("ASDLC-1/AC-31 stack-config.md intro says the harness reads the key and unread keys are marked", () => {
    const text = read("okf/references/stack-config.md");
    const intro = (text.split(/^---$/m)[2] ?? "").trim().split("\n\n")[0] ?? "";
    expect(intro).not.toMatch(/^\*\*Proposed\.\*\*/);
    expect(intro).toMatch(/read by the harness|the harness reads/i);
    const rowOf = (key: string): string =>
      text.split("\n").find((l) => new RegExp(`^\\|\\s*\`(sizing\\.)?${key}`).test(l)) ?? "";
    for (const key of ["split_on", "merge_strategy"]) {
      expect(rowOf(key)).toMatch(/not yet|proposed|planned|later|not read/i);
    }
    expect(rowOf("provider")).toMatch(/only `gh`/i);
  });

  it("ASDLC-1/AC-31 okf/log.md has a dated stack-compute entry covering concepts, plan fields and the phase-plan prompt", () => {
    const matching = datedBullets().filter(
      (bullet) =>
        bullet.text.includes("ASDLC-1") &&
        /stack-compute/.test(bullet.text) &&
        bullet.text.includes("/architecture/evidence-stack.md") &&
        bullet.text.includes("/architecture/tool-surface.md") &&
        bullet.text.includes("/references/stack-config.md") &&
        bullet.text.includes("computeStack") &&
        /phase-plan/.test(bullet.text) &&
        ["est_lines", "concern", "depends_on", "flag", "kind"].every((field) =>
          bullet.text.includes(`\`${field}\``),
        ) &&
        !EXISTING_2026_10_30.includes(bullet.text) &&
        new Date(`${bullet.date}T00:00:00Z`).toISOString().slice(0, 10) === bullet.date,
    );
    for (const text of EXISTING_2026_10_30) {
      expect(datedBullets()).toContainEqual({ date: "2026-10-30", text });
    }
    expect(matching.length).toBeGreaterThanOrEqual(1);
  });

  it("ASDLC-1/AC-31 check:biome exits 0 on the task-32 files", () => {
    const files = [
      "packages/accord-core/schemas/accord-schema.json",
      "packages/accord-core/tests/alignment.test.ts",
      "packages/accord-core/tests/docs-validation.test.ts",
    ];
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
});

// ASDLC-1/AC-31 (task 38): tree-state documentation and log entry.
describe("ASDLC-1/AC-31 tree-state docs (task 38)", () => {
  it("ASDLC-1/AC-31 evidence-stack.md binds the state source files and drops the proposed status for tree state", () => {
    const text = read("okf/architecture/evidence-stack.md");
    for (const file of ["snapshot", "redact", "restore", "closeout"]) {
      expect(text).toContain(`resource: /packages/accord-core/src/state/${file}.ts`);
    }
    const status = text.split("\n").find((l) => /^\*\*(Partly )?[Ii]mplemented/.test(l));
    expect(status).toBeDefined();
    expect(status).toMatch(/tree state|committed state/i);
  });

  it("ASDLC-1/AC-31 evidence-stack.md State persistence section documents redaction, size cap, fresh-clone resume and closeout", () => {
    const section = sectionOf(read("okf/architecture/evidence-stack.md"), "State persistence");
    expect(section).toContain("docs/dev/<ID>/state/");
    expect(section).toMatch(/redact/i);
    expect(section).toContain("stack.state.redact");
    expect(section).toContain("stack.state.max_bytes");
    expect(section).toMatch(/raw packets?/i);
    expect(section).toMatch(/fresh clone/i);
    expect(section).toContain("closeout");
    expect(section).toContain("STATE.md");
    expect(section).toContain("accord/evidence");
  });

  it("ASDLC-1/AC-31 artifacts-and-state.md lists docs/dev/<ID>/state/ and the closeout marker in the Committed table", () => {
    const text = read("okf/references/artifacts-and-state.md");
    const committed = sectionOf(`\n${text}`, "Committed — `docs/dev/<ID>/`");
    const stateRow = committed.split("\n").find((l) => /^\|\s*`state\/task-<N>\//.test(l));
    expect(stateRow).toBeDefined();
    expect(stateRow).toContain("STATE.md");
    expect(stateRow).toMatch(/redact/i);
    expect(stateRow).toMatch(/deleted|removed/i);
    const closeoutRow = committed
      .split("\n")
      .find((l) => /^\|\s*`evidence\/closeout\.json`/.test(l));
    expect(closeoutRow).toBeDefined();
  });

  it("ASDLC-1/AC-31 artifacts-and-state.md documents the closeout order and resume from a fresh clone", () => {
    const text = read("okf/references/artifacts-and-state.md");
    expect(text).toMatch(/fresh clone/i);
    expect(text).toContain("closeout");
    // Order: state removal lands in the same commit as trace/verify/cost, after they are built.
    const closeoutLine = text
      .split("\n")
      .find((l) => /closeout/i.test(l) && l.includes("state/") && /trace/.test(l));
    expect(closeoutLine).toBeDefined();
    expect(text).toContain("accord/evidence");
  });

  it("ASDLC-1/AC-31 stack-config.md describes state.redact must stay true, raw packets excluded, and the max_bytes cap", () => {
    const text = read("okf/references/stack-config.md");
    const redactRow = text.split("\n").find((l) => /^\|\s*`state\.redact`/.test(l));
    expect(redactRow).toBeDefined();
    expect(redactRow).toMatch(/raw packets?/i);
    const maxRow = text.split("\n").find((l) => /^\|\s*`state\.max_bytes`/.test(l));
    expect(maxRow).toBeDefined();
    expect(maxRow).toContain("262144");
    const persistRow = text.split("\n").find((l) => /^\|\s*`state\.persist`/.test(l));
    expect(persistRow).toMatch(/closeout/);
    expect(text).toMatch(/fresh clone|resume/i);
  });

  it("ASDLC-1/AC-31 okf/log.md has a dated tree-state entry naming the three updated concepts", () => {
    const matching = datedBullets().filter(
      (bullet) =>
        bullet.text.includes("ASDLC-1") &&
        bullet.text.includes("tree-state") &&
        bullet.text.includes("/references/artifacts-and-state.md") &&
        bullet.text.includes("/architecture/evidence-stack.md") &&
        bullet.text.includes("/references/stack-config.md") &&
        new Date(`${bullet.date}T00:00:00Z`).toISOString().slice(0, 10) === bullet.date,
    );
    expect(matching.length).toBeGreaterThanOrEqual(1);
  });
});

describe("ASDLC-1/AC-31 trunk-hardening docs (task 42)", () => {
  const lines = (rel: string): string[] => read(rel).split("\n");

  it("ASDLC-1/AC-31 evidence-stack.md describes the trunk-hardening stack: depth cap, require_flag, bottom-up merge, overrun", () => {
    const text = read("okf/architecture/evidence-stack.md");
    const section = lines("okf/architecture/evidence-stack.md");
    const status = section.find((l) => /^\*\*(Partly )?[Ii]mplemented/.test(l)) ?? "";
    expect(status).toMatch(/trunk-hardening[^.]*implemented|implemented[^.]*trunk-hardening/i);
    expect(status).not.toMatch(/trunk-hardening[^.]*(not yet|proposed|planned)/i);
    expect(status).toMatch(/overrun/i);
    expect(text).toContain("resource: /packages/accord-core/src/stack/overrun.ts");
    expect(text).toContain("resource: /packages/accord-core/src/stack/depth.ts");
    expect(text).not.toMatch(/overrun_factor` is planned/);
    const rf = section.find((l) => l.includes("`require_flag`")) ?? "";
    expect(rf).toMatch(/missing_flag|premature_enable|missing_enable|`kind`[^\n]*enable/);
    expect(rf).not.toMatch(/`require_flag`[^.]*(not yet|planned|proposed)/i);
    expect(text).toContain("`overrun-task-<N>`");
    expect(text).toContain("`stack.overrun.detected`");
    expect(text).toMatch(/`max_depth`[^\n]*(openablePrs|stack submit|dev_stack_submit)/);
  });

  it("ASDLC-1/AC-31 orchestration-policy.md documents max_depth, require_flag, bottom-up merge with merge-main retarget, and the overrun decision", () => {
    const text = read("okf/references/orchestration-policy.md");
    expect(text).toContain("stack.sizing.max_depth");
    expect(text).toContain("stack.require_flag");
    expect(text).toContain("stack.sizing.overrun_factor");
    expect(text).toMatch(/bottom-up/i);
    expect(text).toContain("stack.enabled");
    expect(text).toContain("advanceStack");
    expect(text).not.toMatch(/dev_stack_sync[^\n]*(merge|retarget|advance)/i);
    const overrunLine = text.split("\n").find((l) => l.includes("overrun-task-<N>")) ?? "";
    expect(overrunLine).toMatch(/stack\.commits[^\n]*phase/);
    expect(overrunLine).toMatch(/GREEN|phase-code/);
    expect(overrunLine).toMatch(/production[^\n]*test|test[^\n]*production/i);
    expect(text).toContain("--replan");
    expect(text).toMatch(/retarget/i);
    expect(text).toMatch(/merges? `?main`? into/i);
    expect(text).toMatch(/--base main/);
    expect(text).toMatch(/never[^\n]*(rebase|force)/i);
    expect(text).toContain("/architecture/evidence-stack.md");
    for (const f of ["overrun", "depth", "merge-bottom-up"]) {
      expect(text).toContain(`resource: /packages/accord-core/src/stack/${f}.ts`);
    }
  });

  it("ASDLC-1/AC-31 stack-config.md rows for require_flag and merge_strategy are current and lists depth.ts as a source", () => {
    // Needs okf/references/stack-config.md, outside task 42 files[] (see escalation).
    const text = read("okf/references/stack-config.md");
    const row = text.split("\n").find((l) => /^\|\s*`require_flag`/.test(l)) ?? "";
    expect(row).not.toMatch(/not yet read|planned for trunk-hardening/i);
    expect(row).toMatch(/stack submit|dev_stack_submit/);
    expect(row).toMatch(/missing_flag|premature_enable|missing_enable/);
    const mergeRow = text.split("\n").find((l) => /^\|\s*`merge_strategy`/.test(l)) ?? "";
    expect(mergeRow).not.toMatch(/planned for trunk-hardening/);
    expect(text).toContain("resource: /packages/accord-core/src/stack/depth.ts");
  });

  it("ASDLC-1/AC-31 artifacts-and-state.md trace.json row records est_lines, act_prod_lines and act_test_lines", () => {
    // Needs okf/references/artifacts-and-state.md, outside task 42 files[] (see escalation).
    const row =
      read("okf/references/artifacts-and-state.md")
        .split("\n")
        .find((l) => l.includes("trace.json")) ?? "";
    expect(row).toContain("est_lines");
    expect(row).toContain("act_prod_lines");
    expect(row).toContain("act_test_lines");
  });

  it("ASDLC-1/AC-31 answer-decisions.md lists the overrun decision with its two options", () => {
    const all = lines("okf/playbooks/answer-decisions.md");
    const text = all.join("\n");
    expect(text).toContain("overrun-task-<N>");
    expect(all.some((l) => l.includes("/dev amend-spec") && l.includes("--replan"))).toBe(true);
    const answerLines = all.filter((l) => /answer \S+ overrun-task-(?:<N>|\d+)/.test(l));
    expect(answerLines.length).toBeGreaterThanOrEqual(2);
    expect(answerLines.some((l) => /"accept[^"]*"/i.test(l))).toBe(true);
    expect(text).toContain("resource: /packages/accord-core/src/stack/overrun.ts");
    expect(all.some((l) => l === "# Trigger")).toBe(true);
    expect(all.some((l) => l === "# Bypass")).toBe(true);
  });

  it("ASDLC-1/AC-31 okf/log.md has a dated trunk-hardening entry naming the updated concepts", () => {
    // The earlier tree-state bullet must stay untouched (append, not edit).
    expect(datedBullets()).toContainEqual({
      date: "2026-11-02",
      text: "* **Update**: ASDLC-1 tree-state: [Artifacts and state](/references/artifacts-and-state.md) (`state/task-<N>/`, `evidence/closeout.json`, closeout order, resume from a fresh clone), [Evidence stack](/architecture/evidence-stack.md) (state persistence, redaction, size cap, `src/state/` sources) and [Stack configuration](/references/stack-config.md) (`state.redact`, `state.max_bytes`, `state.persist`) now describe the implemented tree state.",
    });
    const matching = datedBullets().filter(
      (bullet) =>
        bullet.text.includes("ASDLC-1") &&
        bullet.text.includes("trunk-hardening") &&
        !bullet.text.includes("tree-state") &&
        !bullet.text.includes("stack-compute") &&
        bullet.text.includes("/architecture/evidence-stack.md") &&
        bullet.text.includes("/references/orchestration-policy.md") &&
        bullet.text.includes("/playbooks/answer-decisions.md") &&
        bullet.text.includes("/references/stack-config.md") &&
        bullet.text.includes("/references/artifacts-and-state.md") &&
        new Date(`${bullet.date}T00:00:00Z`).toISOString().slice(0, 10) === bullet.date,
    );
    expect(matching.length).toBeGreaterThanOrEqual(1);
  });
});

describe("ASDLC-1/AC-31 feature-drift CI docs (task 47)", () => {
  const section = (): string => {
    const text = read("docs/ci/pre-merge-smoke.md");
    const start = text.indexOf("## accord/evidence");
    expect(start).toBeGreaterThanOrEqual(0);
    const rest = text.slice(start + 3);
    const next = rest.search(/^## /m);
    return next === -1 ? rest : rest.slice(0, next);
  };

  it("ASDLC-1/AC-31 pre-merge-smoke.md documents the feature-drift rule in the accord/evidence section", () => {
    const text = section();
    expect(text).toContain("feature-drift");
    expect(text).toContain("packages/accord-ci/src/checks/feature-drift.ts");
    expect(text).toContain("knowledge.drift_check");
    for (const mode of ["off", "warn", "block"]) expect(text).toContain(`\`${mode}\``);
    expect(text).toContain("Feature-Unchanged:");
  });

  it("ASDLC-1/AC-31 pre-merge-smoke.md lists the feature-drift test command", () => {
    const lines = section().split("\n");
    expect(lines).toContain("bun test packages/accord-ci/tests/feature-drift-ci.test.ts");
  });
});

describe("ASDLC-1/AC-30 feature-knowledge schema descriptions (task 50)", () => {
  const accordSchema = (): { properties: { knowledge: { description: string } } } =>
    JSON.parse(read("packages/accord-core/schemas/accord-schema.json"));
  const specSchema = (): {
    properties: {
      features: { description: string };
      acceptance_criteria: { items: { properties: { feature: { description: string } } } };
    };
  } => JSON.parse(read("packages/accord-core/schemas/spec-schema.json"));

  it("ASDLC-1/AC-30 knowledge description states keys are read by the harness and default off", () => {
    const description = accordSchema().properties.knowledge.description;
    expect(description).toContain("read by the harness");
    expect(description).toContain("default off");
    expect(description).not.toContain("not yet read");
    expect(description).not.toContain("PROPOSED");
  });

  it("ASDLC-1/AC-30 spec feature field description states it is read by the harness and no longer proposed", () => {
    const description =
      specSchema().properties.acceptance_criteria.items.properties.feature.description;
    expect(description).toContain("read by the harness");
    expect(description).not.toContain("not yet read");
    expect(description).not.toContain("PROPOSED");
  });

  it("ASDLC-1/AC-30 spec features[] description states default off", () => {
    const description = specSchema().properties.features.description;
    expect(description).toContain("knowledge.enabled");
    expect(description).toContain("default off");
  });
});

describe("ASDLC-1/AC-31 feature-knowledge docs (task 50)", () => {
  it("ASDLC-1/AC-31 knowledge-config.md is no longer marked proposed", () => {
    const text = read("okf/references/knowledge-config.md");
    expect(text).not.toMatch(/^status: proposed/m);
    expect(text).not.toContain("The harness does not read it yet");
    expect(text).not.toContain("**Proposed.**");
  });

  it("ASDLC-1/AC-31 knowledge-config.md documents docs/features, impact analysis, drift check and the dev_feature tools", () => {
    const text = read("okf/references/knowledge-config.md");
    for (const term of [
      "docs/features",
      "index.json",
      "impact",
      "drift",
      "validate:features",
      "dev_feature_find",
      "dev_feature_impact",
    ]) {
      expect(text).toContain(term);
    }
  });

  it("ASDLC-1/AC-31 tool-surface.md documents dev_feature_find and dev_feature_impact", () => {
    const text = read("okf/architecture/tool-surface.md");
    expect(text).toContain("dev_feature_find");
    expect(text).toContain("dev_feature_impact");
  });

  it("ASDLC-1/AC-31 okf/log.md has a dated ASDLC-1 feature-knowledge entry naming knowledge-config and tool-surface, after the prior bullets", () => {
    const bullets = datedBullets();
    const index = bullets.findIndex(
      (bullet) =>
        bullet.text.includes("ASDLC-1 feature-knowledge") &&
        bullet.text.includes("/references/knowledge-config.md") &&
        bullet.text.includes("/architecture/tool-surface.md"),
    );
    expect(index).toBeGreaterThan(-1);
    expect(bullets[index]?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // append-only: later entries (ci-driven-mode, task 54) may follow it, never precede it
    expect(index).toBeLessThanOrEqual(bullets.length - 1);
  });
});

// ASDLC-1/AC-31 (task 54): ci-driven-mode documentation and log entry.
describe("ASDLC-1/AC-31 ci-driven-mode docs (task 54)", () => {
  const sources = (): Record<string, string> => ({
    playbook: read("okf/playbooks/adopt-autopipeline.md"),
    env: read("okf/references/environment-variables.md"),
    ci: read("docs/ci/autopipeline.md"),
  });

  it("ASDLC-1/AC-31 environment-variables.md documents ACCORD_CI_PUSH_TOKEN as required, server-only, 90-day rotation", () => {
    const text = sources().env;
    const row = text.split("\n").find((l) => /^\|/.test(l) && l.includes("`ACCORD_CI_PUSH_TOKEN`"));
    expect(row).toBeDefined();
    expect(row).toMatch(/required/i);
    expect(row).toMatch(/90[- ]day/i);
    expect(row).toMatch(/server|CI only|CI-only/i);
  });

  it("ASDLC-1/AC-31 docs/ci/autopipeline.md documents CI-driven mode trigger, gates, cost cap, alert channel and token", () => {
    const text = sources().ci;
    expect(text).toMatch(/CI-driven/i);
    expect(text).toContain("brief.md");
    expect(text).toContain("spec.json");
    expect(text).toContain("contract.lock.json");
    expect(text).toContain("stack.ci.cost_cap_usd");
    expect(text).toContain("#accord-ci-alerts");
    expect(text).toMatch(/PR comment/i);
    expect(text).toContain("ACCORD_CI_PUSH_TOKEN");
    expect(text).toMatch(/90[- ]day/i);
    expect(text).toMatch(/human gate|gate/i);
    expect(text).toContain("/accord unblock");
  });

  it("ASDLC-1/AC-31 adopt-autopipeline.md playbook covers CI-driven mode and the push token step", () => {
    const text = sources().playbook;
    expect(text).toMatch(/CI-driven/i);
    expect(text).toContain("ACCORD_CI_PUSH_TOKEN");
    expect(text).toContain("stack.ci.cost_cap_usd");
    expect(text).toContain("#accord-ci-alerts");
    expect(text).toMatch(/90[- ]day/i);
    expect(text).toContain("accord-driven.yml");
  });

  it("ASDLC-1/AC-31 okf/log.md has a dated ASDLC-1 ci-driven-mode entry naming the updated concepts, appended last", () => {
    const bullets = datedBullets();
    const index = bullets.findIndex(
      (bullet) =>
        bullet.text.includes("ASDLC-1 ci-driven-mode") &&
        bullet.text.includes("/playbooks/adopt-autopipeline.md") &&
        bullet.text.includes("/references/environment-variables.md") &&
        bullet.text.includes("ACCORD_CI_PUSH_TOKEN"),
    );
    expect(index).toBe(bullets.length - 1);
    expect(new Date(`${bullets[index]?.date}T00:00:00Z`).toISOString().slice(0, 10)).toBe(
      bullets[index]?.date,
    );
  });
});
