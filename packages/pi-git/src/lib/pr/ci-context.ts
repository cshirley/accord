/**
 * gh_ci_context — PR merge/check state + failed workflow log excerpts.
 */

import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { extractTicket, gh, git, gitRoot, truncateLines } from "../git.js";

export interface CheckRollupItem {
  name: string;
  state: string;
  bucket: string;
  link?: string;
  workflow?: string;
}

export interface FailedRunSummary {
  databaseId: number;
  displayTitle: string;
  workflowName: string;
  conclusion: string;
  url: string;
  logExcerpt: string;
}

export interface GhCiContextData {
  branch: string;
  ticket: string | null;
  ghAuth: boolean;
  pr: {
    number: number;
    url: string;
    title: string;
    state: string;
    mergeable: string;
    mergeStateStatus: string;
    reviewDecision: string;
    baseRefName: string;
    headRefName: string;
    checks: CheckRollupItem[];
  } | null;
  failedRuns: FailedRunSummary[];
}

function parseChecks(statusCheckRollup: unknown): CheckRollupItem[] {
  if (!statusCheckRollup || typeof statusCheckRollup !== "object") return [];
  const rollup = statusCheckRollup as {
    state?: string;
    contexts?: Array<{
      name?: string;
      state?: string;
      targetUrl?: string;
      context?: string;
    }>;
  };
  const bucket = rollup.state ?? "UNKNOWN";
  const contexts = rollup.contexts ?? [];
  return contexts.map((c) => ({
    name: c.name ?? c.context ?? "(unknown)",
    state: c.state ?? "UNKNOWN",
    bucket,
    link: c.targetUrl,
  }));
}

export function formatGhCiContext(d: GhCiContextData): string {
  const out: string[] = [];
  out.push(`Branch: ${d.branch}`);
  out.push(`Ticket: ${d.ticket ?? "(not detected)"}`);
  out.push(`gh auth: ${d.ghAuth ? "✓" : "✗ — run \`gh auth login\`"}`);

  if (!d.pr) {
    out.push("\nPR: none on current branch — open one with gh_pr_submit or /pr");
    return out.join("\n");
  }

  out.push(`\nPR #${d.pr.number}: ${d.pr.title}`);
  out.push(`  ${d.pr.url}`);
  out.push(`  mergeable: ${d.pr.mergeable}  mergeStateStatus: ${d.pr.mergeStateStatus}`);
  out.push(`  reviewDecision: ${d.pr.reviewDecision}`);
  out.push(`  base: ${d.pr.baseRefName} ← head: ${d.pr.headRefName}`);

  const failing = d.pr.checks.filter((c) => c.state !== "SUCCESS" && c.state !== "NEUTRAL");
  const passing = d.pr.checks.filter((c) => c.state === "SUCCESS");
  out.push(`\nChecks: ${passing.length} passing, ${failing.length} not passing`);
  for (const c of failing.slice(0, 20)) {
    out.push(`  ✗ ${c.name} [${c.state}]${c.link ? ` — ${c.link}` : ""}`);
  }
  if (failing.length > 20) out.push(`  … and ${failing.length - 20} more`);

  if (d.failedRuns.length > 0) {
    out.push("\nFailed workflow runs (log excerpts):");
    for (const run of d.failedRuns) {
      out.push(`\n### ${run.workflowName}: ${run.displayTitle} (${run.conclusion})`);
      out.push(run.url);
      const [excerpt, truncated] = truncateLines(run.logExcerpt, 40);
      out.push(truncated ? `${excerpt}\n… (truncated)` : excerpt);
    }
  } else if (failing.length > 0) {
    out.push("\n(No failed workflow log fetched — checks may be external or still running.)");
  }

  return out.join("\n");
}

export async function runGhCiContext(
  cwd: string,
  signal: AbortSignal | undefined,
  onUpdate: ((partial: AgentToolResult<unknown>) => void) | undefined,
): Promise<GhCiContextData> {
  const root = await gitRoot(cwd, signal);

  onUpdate?.({
    content: [{ type: "text", text: "Gathering CI context..." }],
    details: { progress: 10 },
  });

  let ghAuth = true;
  try {
    await gh(["auth", "status"], root, signal);
  } catch {
    ghAuth = false;
  }

  const branch = (await git(["branch", "--show-current"], root, signal)).trim();
  const ticket = extractTicket(branch);

  if (!ghAuth) {
    return { branch, ticket, ghAuth, pr: null, failedRuns: [] };
  }

  const prRaw = await gh(
    [
      "pr",
      "view",
      "--json",
      "number,url,title,state,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,baseRefName,headRefName",
    ],
    root,
    signal,
  ).catch(() => null);

  let pr: GhCiContextData["pr"] = null;
  if (prRaw) {
    try {
      const parsed = JSON.parse(prRaw);
      pr = {
        number: parsed.number,
        url: parsed.url,
        title: parsed.title,
        state: parsed.state,
        mergeable: String(parsed.mergeable ?? "UNKNOWN"),
        mergeStateStatus: String(parsed.mergeStateStatus ?? "UNKNOWN"),
        reviewDecision: String(parsed.reviewDecision ?? "NONE"),
        baseRefName: parsed.baseRefName,
        headRefName: parsed.headRefName,
        checks: parseChecks(parsed.statusCheckRollup),
      };
    } catch {
      /* malformed */
    }
  }

  const failedRuns: FailedRunSummary[] = [];
  const hasFailingChecks = pr?.checks.some((c) => c.state !== "SUCCESS" && c.state !== "NEUTRAL");

  if (hasFailingChecks && branch) {
    onUpdate?.({
      content: [{ type: "text", text: "Fetching failed workflow logs..." }],
      details: { progress: 50 },
    });

    const runsRaw = await gh(
      [
        "run",
        "list",
        "--branch",
        branch,
        "--limit",
        "8",
        "--json",
        "databaseId,displayTitle,conclusion,url,workflowName,status",
      ],
      root,
      signal,
    ).catch(() => "");

    let runs: Array<{
      databaseId: number;
      displayTitle: string;
      conclusion: string;
      url: string;
      workflowName: string;
      status: string;
    }> = [];
    try {
      runs = JSON.parse(runsRaw);
    } catch {
      runs = [];
    }

    const failed = runs.filter((r) => r.conclusion === "failure" || r.conclusion === "cancelled");
    for (const run of failed.slice(0, 2)) {
      const log = await gh(["run", "view", String(run.databaseId), "--log-failed"], root, signal).catch(
        () => "",
      );
      const [excerpt] = truncateLines(log.trim() || "(no log output)", 80);
      failedRuns.push({
        databaseId: run.databaseId,
        displayTitle: run.displayTitle,
        workflowName: run.workflowName,
        conclusion: run.conclusion,
        url: run.url,
        logExcerpt: excerpt,
      });
    }
  }

  return { branch, ticket, ghAuth, pr, failedRuns };
}
