import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync } from "node:fs";
import { detectResumeTrigger, type ResumeEvent } from "./resume.js";

const ZERO_SHA = /^0+$/;

function git(repoRoot: string, args: string[]): string {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function changedFiles(repoRoot: string, before: string, after: string): string[] {
  const args = ZERO_SHA.test(before)
    ? ["diff-tree", "--no-commit-id", "--name-only", "-r", after]
    : ["diff", "--name-only", before, after];
  try {
    return git(repoRoot, args).split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

function output(line: string): void {
  const file = process.env.GITHUB_OUTPUT;
  if (file) appendFileSync(file, `${line}\n`);
}

const repoRoot = process.env.GITHUB_WORKSPACE || process.cwd();
const payload = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH ?? "", "utf8")) as {
  before?: string;
  after?: string;
  comment?: { body?: string; author_association?: string };
  issue?: { number?: number; pull_request?: unknown };
};

let event: ResumeEvent | null = null;
let prNumber = "";
if (process.env.GITHUB_EVENT_NAME === "push") {
  event = {
    name: "push",
    branch: process.env.GITHUB_REF_NAME ?? "",
    changedFiles: changedFiles(repoRoot, payload.before ?? "", payload.after ?? ""),
  };
} else if (process.env.GITHUB_EVENT_NAME === "issue_comment" && payload.issue?.number) {
  prNumber = String(payload.issue.number);
  const isPullRequest = Boolean(payload.issue.pull_request);
  let prBranch = "";
  if (isPullRequest) {
    const view = JSON.parse(
      execFileSync("gh", ["pr", "view", prNumber, "--json", "headRefName,isCrossRepository"], {
        cwd: repoRoot,
        encoding: "utf8",
      }),
    ) as { headRefName?: string; isCrossRepository?: boolean };
    prBranch = view.isCrossRepository ? "" : (view.headRefName ?? "");
  }
  event = {
    name: "issue_comment",
    body: payload.comment?.body ?? "",
    authorAssociation: payload.comment?.author_association ?? "",
    isPullRequest,
    prBranch,
  };
}

const result = event ? detectResumeTrigger({ repoRoot, event }) : null;
if (result?.trigger) {
  output("run=true");
  output(`work_item_id=${result.workItemId}`);
  output(`ref=${event?.name === "issue_comment" ? event.prBranch : ""}`);
  output(`pr=${event?.name === "issue_comment" ? prNumber : ""}`);
}
console.log(
  result?.trigger
    ? `accord-driven: resume trigger (${result.kind})`
    : `accord-driven: skipped (${result ? result.reason : "unsupported_event"})`,
);
