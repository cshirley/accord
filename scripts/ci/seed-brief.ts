/**
 * AC-5 (brief slice): synthesise `docs/dev/<ticket>/brief.md` from a Jira
 * payload so downstream phases skip `phase-align` and `phase-gather`.
 *
 * The brief follows the canonical `phase-align` shape (`## Core Problem`,
 * `## Desired Outcome`, `## Scope`, `## Gathered Context`). A
 * `Generated at <UTC ISO>` line goes into `## Gathered Context` so
 * `decide-resume.ts` can strip it before hashing — the brief hash is used
 * to decide resume eligibility across reruns.
 *
 * Slugify is exported too — task 9's `commit-and-pr.ts` uses it to build
 * the deterministic branch name `<inputs.branch_prefix><ticket>-<slug>`
 * (AC-11).
 *
 * No LLM call. No Jira write. Idempotent (re-running overwrites brief.md).
 *
 * When `ticket.fields.comment` is present, every key on the container and every
 * field on each entry in `comments` is preserved via JSON (including `body`
 * whether string or ADF).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { JiraIssue, JiraIssueFieldsComment } from "./gate-ticket.js";

export interface SeedBriefOpts {
  readonly ticket: JiraIssue;
  readonly outDir: string;
}

export interface SeedBriefResult {
  readonly briefPath: string;
  readonly slug: string;
}

const MAX_SLUG_LEN = 60;

export function slugify(summary: string): string {
  // Lowercase, replace any non-[a-z0-9] run with a single dash, trim edges.
  const lowered = summary.toLowerCase();
  const dashed = lowered.replace(/[^a-z0-9]+/g, "-");
  const trimmed = dashed.replace(/^-+|-+$/g, "");
  if (trimmed === "") return "untitled";
  if (trimmed.length <= MAX_SLUG_LEN) return trimmed;
  const truncated = trimmed.slice(0, MAX_SLUG_LEN);
  // Avoid trailing dash if truncation falls on one.
  return truncated.replace(/-+$/g, "");
}

function fencedJson(value: unknown): string {
  // Tilde fences avoid breaking when serialized JSON contains Markdown backticks.
  const serial = JSON.stringify(value, null, 2);
  return `~~~json\n${serial}\n~~~\n`;
}

/** Serialises `fields.comment` and each comment object with every key preserved. */
function renderJiraCommentsBlock(comment: JiraIssueFieldsComment | undefined): string {
  const lines: string[] = [];
  lines.push("### Jira comments (full REST fields)");
  lines.push("");
  lines.push(
    "Each block below is JSON from the Jira payload so no comment field is dropped (author, visibility, renderedBody, ADF `body`, etc.).",
  );
  lines.push("");

  if (comment === undefined) {
    lines.push("_No `fields.comment` object was supplied on this issue._");
    lines.push("");
    return lines.join("\n");
  }

  const entries = Object.entries(comment).filter(([k]) => k !== "comments");
  if (entries.length > 0) {
    const meta: Record<string, unknown> = {};
    for (const [k, v] of entries) {
      meta[k] = v;
    }
    lines.push("#### Comment container (all non-`comments` fields)");
    lines.push("");
    lines.push(fencedJson(meta));
    lines.push("");
  }

  const rawComments = comment.comments;
  if (!Array.isArray(rawComments) || rawComments.length === 0) {
    lines.push("_The `comments` array is missing or empty — no inline comments to embed._");
    lines.push("");
    return lines.join("\n");
  }

  for (let commentIndex = 0; commentIndex < rawComments.length; commentIndex++) {
    const commentPayload = rawComments[commentIndex];
    let jiraId: string | null = null;
    if (commentPayload !== null && typeof commentPayload === "object" && "id" in commentPayload) {
      const raw = (commentPayload as { id: unknown }).id;
      if (typeof raw === "string" && raw !== "") jiraId = raw;
      else if (typeof raw === "number") jiraId = String(raw);
    }
    lines.push(`#### Comment ${commentIndex + 1}${jiraId !== null ? ` (id ${jiraId})` : ""}`);
    lines.push("");
    lines.push(fencedJson(commentPayload));
    lines.push("");
  }

  return lines.join("\n");
}

function renderBrief(ticket: JiraIssue, generatedAt: string): string {
  const lines: string[] = [];
  lines.push(`# ${ticket.key}: ${ticket.fields.summary}`);
  lines.push("");
  lines.push(
    `*Seeded from Jira by the ACCORD autopipeline. Ticket ${ticket.key}, status ${ticket.fields.status.name}, type ${ticket.fields.issuetype.name}.*`,
  );
  lines.push("");

  lines.push("## Core Problem");
  lines.push("");
  lines.push(
    "Synthesised verbatim from the Jira ticket description. The autopipeline trusts the ticket-gate (AC-3) to have already verified the description carries problem framing, ACs, scope, and target paths.",
  );
  lines.push("");
  lines.push("### Ticket description (verbatim)");
  lines.push("");
  lines.push(ticket.fields.description);
  lines.push("");
  lines.push(renderJiraCommentsBlock(ticket.fields.comment));
  lines.push("## Desired Outcome");
  lines.push("");
  lines.push(
    `Implement the acceptance criteria listed in ${ticket.key} ("${ticket.fields.summary}") and land them as a single reviewable PR. Verification is the project-level test/typecheck/lint set declared in AGENTS.md → \`## Dev Harness\`.`,
  );
  lines.push("");

  lines.push("## Scope");
  lines.push("");
  lines.push(
    `- **Target paths:** as declared in the ticket's \`## Target paths\` section (or \`## Areas\` / \`## Target area\`).`,
  );
  lines.push(
    "- **Out of scope:** as declared in the ticket's `## Out of scope` section. The autopipeline will reject deviations beyond that set.",
  );
  lines.push(`- **Issue type:** ${ticket.fields.issuetype.name}`);
  lines.push(`- **Trigger status:** ${ticket.fields.status.name}`);
  lines.push("");

  lines.push("## Gathered Context");
  lines.push("");
  lines.push(`- Jira ticket: \`${ticket.key}\``);
  lines.push(`- Issue type: \`${ticket.fields.issuetype.name}\``);
  lines.push(`- Status at trigger: \`${ticket.fields.status.name}\``);
  lines.push(`- Generated at ${generatedAt}`);
  lines.push("");
  lines.push(
    "Phase agents may treat the gathered-context block as authoritative for the Jira facts above and SHOULD skip `phase-gather` for this work item.",
  );
  lines.push("");
  return lines.join("\n");
}

export function seedBrief(opts: SeedBriefOpts): SeedBriefResult {
  mkdirSync(opts.outDir, { recursive: true });
  const generatedAt = new Date().toISOString();
  const briefPath = join(opts.outDir, "brief.md");
  writeFileSync(briefPath, renderBrief(opts.ticket, generatedAt), "utf8");
  return {
    briefPath,
    slug: slugify(opts.ticket.fields.summary),
  };
}
