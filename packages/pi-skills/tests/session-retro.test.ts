import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "..", "scripts", "session-retro.ts");

type Step =
  | { user: string }
  | { tool: string; args?: Record<string, unknown>; id?: string }
  | { result: string; error?: boolean };

const bash = (command: string, id?: string): Step => ({ tool: "bash", args: { command }, id });

function toLines(steps: Step[]): string {
  return `${steps
    .map((step) => {
      if ("user" in step) {
        return JSON.stringify({ type: "message", message: { role: "user", content: step.user } });
      }
      if ("result" in step) {
        return JSON.stringify({
          type: "message",
          message: {
            role: "toolResult",
            toolCallId: step.result,
            toolName: "bash",
            isError: step.error ?? false,
            content: [{ type: "text", text: step.error ? "failed" : "ok" }],
          },
        });
      }
      return JSON.stringify({
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "toolCall", id: step.id, name: step.tool, arguments: step.args ?? {} }],
        },
      });
    })
    .join("\n")}\n`;
}

type Report = {
  sessionFiles: number;
  since: string | null;
  until: string | null;
  gates: Record<string, number>;
  adoption: {
    greenMark: number;
    greenCheck: number;
    reviewMark: number;
    wtGuard: number;
    docVerify: number;
    adhocBootstrap: number;
    skillReads: Record<string, number>;
  };
};

function runRetro(root: string, extra: string[] = []) {
  return Bun.spawnSync([process.execPath, script, "--json", "--sessions-root", root, ...extra], {
    stdout: "pipe",
    stderr: "pipe",
  });
}

function retro(root: string, extra: string[] = []): Report {
  const proc = runRetro(root, extra);
  expect(proc.exitCode).toBe(0);
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
      bash("bun test"),
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

  test("bash git commit, gh pr create and gh pr checks are detected; review via subagent counts", () => {
    session("2026-10-03T10-00-00-000Z_c.jsonl", [
      { tool: "edit" },
      bash("git commit -m x"),
      { tool: "subagent", args: { tasks: [{ agent: "review-code", task: "t" }] } },
      bash("gh pr create --fill"),
      bash("gh pr checks 12"),
    ]);
    const { gates } = retro(root);
    expect(gates.commits).toBe(1);
    expect(gates.commitsWithUnverifiedEdits).toBe(1);
    expect(gates.commitsBeforeAnyReview).toBe(1);
    expect(gates.prSubmits).toBe(1);
    expect(gates.sessionsWithPrNoCiCheck).toBe(0);
  });

  test("a command that only mentions git commit or a test runner is not counted", () => {
    session("2026-10-03T11-00-00-000Z_d.jsonl", [
      { tool: "edit" },
      bash('echo "git commit" && rg "bun test" src'),
      bash("git commit -m x"),
    ]);
    const { gates } = retro(root);
    expect(gates.commits).toBe(1);
    expect(gates.commitsWithUnverifiedEdits).toBe(1);
    expect(gates.sessionsEditedNeverVerified).toBe(1);
  });

  test("verify and commit chained with && are read in order; commit before verify is unverified", () => {
    session("2026-10-04T10-00-00-000Z_e.jsonl", [
      { tool: "edit" },
      bash("cd app && bun test && git commit -am x", "call-1"),
      { result: "call-1" },
      { tool: "edit" },
      bash("git commit -am y && bun test", "call-2"),
      { result: "call-2" },
    ]);
    const { gates } = retro(root);
    expect(gates.commits).toBe(2);
    expect(gates.commitsWithUnverifiedEdits).toBe(1);
  });

  test("the shell builtin test is not a verification; verify || commit is unverified", () => {
    session("2026-10-04T12-00-00-000Z_h.jsonl", [
      { tool: "edit" },
      bash("test -f a.ts && git commit -m x"),
      { tool: "edit" },
      bash("bun test || git commit -m y", "call-9"),
      { result: "call-9" },
    ]);
    const { gates } = retro(root);
    expect(gates.commits).toBe(2);
    expect(gates.commitsWithUnverifiedEdits).toBe(2);
  });

  test("newline-separated commands and quoted operators are read correctly", () => {
    session("2026-10-04T13-00-00-000Z_i.jsonl", [
      { tool: "edit" },
      bash("git add -A\ngit commit -m x"),
      { tool: "edit" },
      bash('git commit -m "fix a | bun test"'),
      { tool: "edit" },
      bash("bun test\ngit commit -m z", "call-3"),
      { result: "call-3" },
    ]);
    const { gates } = retro(root);
    expect(gates.commits).toBe(3);
    // newline commit and the quoted `| bun test` are unverified; the real verify then commit is not
    expect(gates.commitsWithUnverifiedEdits).toBe(2);
  });

  test("a failed verify leaves the edits unverified", () => {
    session("2026-10-04T11-00-00-000Z_f.jsonl", [
      { tool: "edit" },
      bash("bun test", "call-1"),
      { result: "call-1", error: true },
      bash("git commit -am x"),
    ]);
    const { gates } = retro(root);
    expect(gates.commitsWithUnverifiedEdits).toBe(1);
    expect(gates.sessionsEditedNeverVerified).toBe(1);
  });

  test("edits never verified; --since is inclusive and --until is exclusive on the file date", () => {
    session("2026-09-01T10-00-00-000Z_old.jsonl", [{ tool: "edit" }]);
    session("2026-10-01T00-00-00-000Z_edge.jsonl", [{ tool: "edit" }]);
    session("2026-10-05T10-00-00-000Z_new.jsonl", [
      { tool: "edit" },
      bash("skills/verify/scripts/green.sh check"),
      bash("skills/verify/scripts/green.sh mark"),
      bash("skills/verify/scripts/green.sh mark review --source branch"),
      bash("skills/worktree/scripts/wt-guard.sh where"),
      bash("python3 skills/doc-verify/scripts/doc-verify.py a.md"),
      bash("accord bootstrap --adhoc x"),
      { tool: "read", args: { path: "/x/skills/brief/SKILL.md" } },
    ]);
    const all = retro(root);
    expect(all.sessionFiles).toBe(3);
    expect(all.gates.sessionsEditedNeverVerified).toBe(3);

    const since = retro(root, ["--since", "2026-10-01"]);
    expect(since.sessionFiles).toBe(2);
    expect(since.since).toBe("2026-10-01");
    expect(since.adoption.greenMark).toBe(1);
    expect(since.adoption.reviewMark).toBe(1);
    expect(since.adoption.greenCheck).toBe(1);
    expect(since.adoption.wtGuard).toBe(1);
    expect(since.adoption.docVerify).toBe(1);
    expect(since.adoption.adhocBootstrap).toBe(1);
    expect(since.adoption.skillReads.brief).toBe(1);

    const before = retro(root, ["--until", "2026-10-01"]);
    expect(before.sessionFiles).toBe(1);
    expect(before.until).toBe("2026-10-01");
  });

  test("rework signals in user prompts are counted", () => {
    session("2026-10-06T10-00-00-000Z_g.jsonl", [
      { user: "that is wrong, revert it" },
      { user: "looks good" },
      { user: "this is still not working" },
    ]);
    expect(retro(root).gates.reworkSignals).toBe(2);
  });

  test("rejects a malformed --since with a clear message", () => {
    const proc = runRetro(root, ["--since", "yesterday"]);
    expect(proc.exitCode).not.toBe(0);
    expect(proc.stderr.toString()).toContain("--since requires YYYY-MM-DD");
    const until = runRetro(root, ["--until", "soon"]);
    expect(until.exitCode).not.toBe(0);
    expect(until.stderr.toString()).toContain("--until requires YYYY-MM-DD");
  });
});
