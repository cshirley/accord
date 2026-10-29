import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "..", "scripts", "session-retro.ts");

type Step = { user: string } | { tool: string; args?: Record<string, unknown> };

function toLines(steps: Step[]): string {
  return `${steps
    .map((step) =>
      JSON.stringify(
        "user" in step
          ? { type: "message", message: { role: "user", content: step.user } }
          : {
              type: "message",
              message: {
                role: "assistant",
                content: [{ type: "toolCall", name: step.tool, arguments: step.args ?? {} }],
              },
            },
      ),
    )
    .join("\n")}\n`;
}

type Report = {
  sessionFiles: number;
  since: string | null;
  gates: Record<string, number>;
  adoption: Record<string, unknown> & { greenMark: number; greenCheck: number; wtGuard: number };
};

function retro(root: string, extra: string[] = []): Report {
  const proc = Bun.spawnSync(["bun", script, "--json", "--sessions-root", root, ...extra], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return JSON.parse(proc.stdout.toString()) as Report;
}

describe("session-retro gates", () => {
  let root = "";

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "retro-"));
    mkdirSync(join(root, "--proj--"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  function session(name: string, steps: Step[]): void {
    writeFileSync(join(root, "--proj--", name), toLines(steps));
  }

  test("counts commits with unverified edits, unreviewed commits and PRs without CI", () => {
    session("2026-10-01T10-00-00-000Z_a.jsonl", [
      { user: "fix it" },
      { tool: "edit" },
      { tool: "git_commit_execute" },
      { tool: "edit" },
      { tool: "bash", args: { command: "bun test" } },
      { tool: "git_review_context" },
      { tool: "git_commit_execute" },
      { tool: "gh_pr_submit" },
    ]);
    session("2026-10-02T10-00-00-000Z_b.jsonl", [
      { tool: "write" },
      { tool: "repo_verify" },
      { tool: "gh_pr_submit" },
      { tool: "gh_ci_context" },
    ]);
    const { gates } = retro(root);
    expect(gates.sessionsWithEdits).toBe(2);
    expect(gates.sessionsEditedNeverVerified).toBe(0);
    expect(gates.commits).toBe(2);
    expect(gates.commitsWithUnverifiedEdits).toBe(1);
    expect(gates.commitsBeforeAnyReview).toBe(1);
    expect(gates.prSubmits).toBe(2);
    expect(gates.sessionsWithPrNoCiCheck).toBe(1);
    expect(gates.firstPromptsUnder100Chars).toBe(1);
  });

  test("edits never verified; --since filters sessions by file name date", () => {
    session("2026-09-01T10-00-00-000Z_old.jsonl", [{ tool: "edit" }]);
    session("2026-10-05T10-00-00-000Z_new.jsonl", [
      { tool: "edit" },
      { tool: "bash", args: { command: "green.sh check" } },
      { tool: "bash", args: { command: "skills/verify/scripts/green.sh mark" } },
      { tool: "bash", args: { command: "skills/worktree/scripts/wt-guard.sh where" } },
    ]);
    const all = retro(root);
    expect(all.sessionFiles).toBe(2);
    expect(all.gates.sessionsEditedNeverVerified).toBe(2);

    const since = retro(root, ["--since", "2026-10-01"]);
    expect(since.sessionFiles).toBe(1);
    expect(since.since).toBe("2026-10-01");
    expect(since.adoption.greenMark).toBe(1);
    expect(since.adoption.greenCheck).toBe(1);
    expect(since.adoption.wtGuard).toBe(1);
  });

  test("rejects a malformed --since", () => {
    const proc = Bun.spawnSync(["bun", script, "--since", "yesterday", "--sessions-root", root], {
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(proc.exitCode).not.toBe(0);
  });
});
