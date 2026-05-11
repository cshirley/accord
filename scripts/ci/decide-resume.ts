/**
 * AC-16 (TC-8): deterministic conjunctive resume gate.
 *
 * Resume the prior run only when ALL THREE conditions hold simultaneously:
 *   (a) `priorState.phase` is one of `speccing` / `planning` / `implementing`
 *   (b) sha256(normalise(priorBrief)) === sha256(normalise(freshBrief))
 *   (c) priorState.cost_usd < maxCostUsd  (STRICTLY less than)
 *
 * Otherwise: return `{decision: 'fresh', reason: <code>, cleanupPaths: [...]}`.
 *
 * Reason precedence (first failing condition wins, with `no_prior_state` as a
 * special pre-check):
 *   no_prior_state > phase_non_resumable > brief_drift > cost_cap_breached
 *
 * `normalise()` strips the `Generated at <ISO>` timestamp line entirely,
 * collapses runs of whitespace, and trims trailing whitespace — so two
 * briefs that differ only in the timestamp + cosmetic whitespace produce
 * the same hash.
 *
 * No subprocess. No LLM. No Jira write — this function only RETURNS the
 * shape of the opening Jira comment; task 11's workflow posts it.
 */

import { createHash } from "node:crypto";

export interface WorkItemState {
  readonly schema_version: string;
  readonly id: string;
  readonly phase: string;
  readonly cost_usd: number;
}

export interface ResumeOpts {
  readonly ticket: string;
  readonly priorState: WorkItemState | null;
  readonly priorBrief: string | null;
  readonly freshBrief: string;
  readonly maxCostUsd: number;
}

export type FreshReason =
  | "no_prior_state"
  | "phase_non_resumable"
  | "brief_drift"
  | "cost_cap_breached";

export interface OpeningJiraComment {
  readonly branch: "resume" | "fresh";
  readonly body: string;
}

export type ResumeDecision =
  | {
      readonly decision: "resume";
      readonly openingJiraComment: OpeningJiraComment;
    }
  | {
      readonly decision: "fresh";
      readonly reason: FreshReason;
      readonly cleanupPaths: readonly string[];
      readonly openingJiraComment: OpeningJiraComment;
    };

const RESUMABLE_PHASES = new Set(["speccing", "planning", "implementing"]);

const GENERATED_AT_LINE_RE = /^[\-\*\s]*Generated at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\s*$/gm;

export function normaliseBrief(brief: string): string {
  return brief
    .replace(GENERATED_AT_LINE_RE, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").replace(/\s+$/g, ""))
    .filter((line) => line !== "")
    .join("\n")
    .trim();
}

function hashBrief(brief: string): string {
  return createHash("sha256").update(normaliseBrief(brief)).digest("hex");
}

function cleanupPathsFor(ticket: string): readonly string[] {
  return [
    `.tasks/${ticket}.json`,
    `.tasks/${ticket}-usage.jsonl`,
    `.tasks/${ticket}-checkpoint.json`,
  ];
}

function commentForResume(ticket: string, phase: string): OpeningJiraComment {
  return {
    branch: "resume",
    body: `**ACCORD autopipeline:** resuming prior run for \`${ticket}\` at phase \`${phase}\`.`,
  };
}

function commentForFresh(ticket: string, reason: FreshReason): OpeningJiraComment {
  return {
    branch: "fresh",
    body: `**ACCORD autopipeline:** starting fresh run for \`${ticket}\`. Reason: \`${reason}\`.`,
  };
}

export function decideResume(opts: ResumeOpts): ResumeDecision {
  // Precedence step 0: no prior state at all.
  if (opts.priorState === null) {
    return {
      decision: "fresh",
      reason: "no_prior_state",
      cleanupPaths: cleanupPathsFor(opts.ticket),
      openingJiraComment: commentForFresh(opts.ticket, "no_prior_state"),
    };
  }

  // (a) phase resumability.
  if (!RESUMABLE_PHASES.has(opts.priorState.phase)) {
    return {
      decision: "fresh",
      reason: "phase_non_resumable",
      cleanupPaths: cleanupPathsFor(opts.ticket),
      openingJiraComment: commentForFresh(opts.ticket, "phase_non_resumable"),
    };
  }

  // (b) brief hash equality.
  const priorHash = opts.priorBrief !== null ? hashBrief(opts.priorBrief) : null;
  const freshHash = hashBrief(opts.freshBrief);
  if (priorHash !== freshHash) {
    return {
      decision: "fresh",
      reason: "brief_drift",
      cleanupPaths: cleanupPathsFor(opts.ticket),
      openingJiraComment: commentForFresh(opts.ticket, "brief_drift"),
    };
  }

  // (c) strictly-below cost cap.
  if (!(opts.priorState.cost_usd < opts.maxCostUsd)) {
    return {
      decision: "fresh",
      reason: "cost_cap_breached",
      cleanupPaths: cleanupPathsFor(opts.ticket),
      openingJiraComment: commentForFresh(opts.ticket, "cost_cap_breached"),
    };
  }

  return {
    decision: "resume",
    openingJiraComment: commentForResume(opts.ticket, opts.priorState.phase),
  };
}
