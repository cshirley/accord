/**
 * `/dev answer` / `accord answer` / `dev_answer` — resolve pending work-item `decisions[]`
 * (spec/plan interview questions, `needs_input` promotions, `stuck` escalations) without
 * hand-editing `.tasks/<ID>.json`.
 *
 * Distinct from `/dev unblock` (`unblock-task.ts`): unblock decides **task-scoped** review
 * findings (`F-n`) / requirements (`AC-n`) and spends unblock budget; answering a decision
 * only flips a **work-item-scoped** `decisions[]` entry to `resolved`. The checkpoint's
 * `answered`/`pending` lists are a derived cache re-synced from `decisions[]`, and the
 * pending-decisions resume gate (`pending-decisions-gate.ts`) reads `decisions[]` directly, so
 * no other state needs touching.
 *
 * All-or-nothing: every answer is validated before the (locked, atomic) write, so a typo in one
 * id never leaves the queue half-answered.
 */

import { parseKnownDevSubcommandArgs } from "../commands/dispatch.js";
import { err, ok, type Result } from "../types/result.js";
import { loadWorkItem, now, readJson, withJsonFileLock, writeJson } from "../work-items/io.js";
import { workItemJsonPath } from "../work-items/tasks-dir.js";
import type { Decision, WorkItem } from "../work-items/types.js";
import { tokenizeArgs } from "./unblock-task.js";

export interface DecisionAnswer {
  /** `decisions[].id`, e.g. `q1` or `phase-code-stuck-1`. */
  id: string;
  /** Free-text answer; must be non-empty. */
  answer: string;
}

export interface AnswerOptions {
  /** Allow overwriting the answer of an already-resolved decision. */
  force?: boolean;
}

export interface PendingDecisionSummary {
  id: string;
  source: string;
  phase?: string;
  question: string;
}

export interface AnswerResult {
  work_item_id: string;
  resolved: { id: string; previously: string }[];
  remaining_pending: PendingDecisionSummary[];
  formatted: string;
}

export interface PendingDecisionsResult {
  work_item_id: string;
  pending: PendingDecisionSummary[];
  formatted: string;
}

function summarise(decision: Decision): PendingDecisionSummary {
  return {
    id: decision.id,
    source: decision.source,
    ...(decision.phase ? { phase: decision.phase } : {}),
    question: decision.question,
  };
}

function pendingOf(wi: WorkItem): PendingDecisionSummary[] {
  return (wi.decisions ?? []).filter((d) => d.status === "pending").map(summarise);
}

function formatPendingList(pending: PendingDecisionSummary[]): string[] {
  return pending.map((d) => `- \`${d.id}\` (${d.source}): ${d.question}`);
}

/** Lists pending `decisions[]` for a work item (the `--list` / no-answer path). */
export function listPendingDecisions(workItemId: string): Result<PendingDecisionsResult> {
  const wi = loadWorkItem(workItemId);
  if (!wi) return err(`Work item not found: ${workItemId}`);
  const pending = pendingOf(wi);
  const formatted =
    pending.length === 0
      ? `${workItemId}: no pending decisions.`
      : [
          `${workItemId}: ${String(pending.length)} pending decision(s)`,
          "",
          ...formatPendingList(pending),
          "",
          `Answer with \`accord answer ${workItemId} <decision-id> "answer"\` (or \`/dev answer\` in Pi).`,
        ].join("\n");
  return ok({ work_item_id: workItemId, pending, formatted });
}

function validateAnswers(
  wi: WorkItem,
  answers: DecisionAnswer[],
  options: AnswerOptions,
): string[] {
  const errors: string[] = [];
  if (answers.length === 0) {
    errors.push("No answers given.");
    return errors;
  }
  const byId = new Map((wi.decisions ?? []).map((d) => [d.id, d]));
  const seen = new Set<string>();
  for (const { id, answer } of answers) {
    if (seen.has(id)) {
      errors.push(`Decision \`${id}\` answered more than once.`);
      continue;
    }
    seen.add(id);
    const decision = byId.get(id);
    if (!decision) {
      errors.push(`Decision \`${id}\` not found on ${wi.id}.`);
      continue;
    }
    if (!answer.trim()) {
      errors.push(`Answer for \`${id}\` is empty.`);
    }
    if (decision.status === "resolved" && !options.force) {
      errors.push(
        `Decision \`${id}\` is already resolved (\`--force\` / \`force: true\` overwrites its answer).`,
      );
    }
  }
  return errors;
}

function formatAnswerResult(
  workItemId: string,
  resolved: AnswerResult["resolved"],
  remaining: PendingDecisionSummary[],
): string {
  const lines = [`${workItemId}: resolved ${resolved.map((r) => `\`${r.id}\``).join(", ")}.`, ""];
  if (remaining.length > 0) {
    lines.push(
      `${String(remaining.length)} decision(s) still pending:`,
      ...formatPendingList(remaining),
      "",
      `Answer them before \`accord resume ${workItemId}\` (or \`/dev resume ${workItemId}\`).`,
    );
  } else {
    lines.push(
      `No pending decisions left \u2014 run \`accord resume ${workItemId}\` (or \`/dev resume ${workItemId}\`).`,
    );
  }
  return lines.join("\n");
}

/**
 * Resolves one or more `decisions[]` entries. Validates everything first; writes once under the
 * work item's JSON lock (atomic rename) so concurrent orchestrator writes serialise with it.
 */
export function answerDecisions(
  workItemId: string,
  answers: DecisionAnswer[],
  options: AnswerOptions = {},
): Result<AnswerResult> {
  const wiPath = workItemJsonPath(workItemId);
  if (!loadWorkItem(workItemId)) return err(`Work item not found: ${workItemId}`); // Explicit lock + read + write (not `mutateJson`): a failed validation must leave the file
  // untouched, and a missing work item must not be created as `null`. Existence is pre-checked
  // above because the lock itself throws when `.tasks/` is absent.
  return withJsonFileLock(wiPath, (): Result<AnswerResult> => {
    const wi = readJson<WorkItem>(wiPath);
    if (!wi) return err(`Work item not found: ${workItemId}`);
    const errors = validateAnswers(wi, answers, options);
    if (errors.length > 0) return err(errors.join("\n"));

    const at = now();
    const answerById = new Map(answers.map((a) => [a.id, a.answer.trim()]));
    const resolved: AnswerResult["resolved"] = [];
    for (const decision of wi.decisions ?? []) {
      const answer = answerById.get(decision.id);
      if (answer === undefined) continue;
      resolved.push({ id: decision.id, previously: decision.status });
      decision.status = "resolved";
      decision.answer = answer;
      decision.resolved_at = at;
    }
    wi.updated = at;
    writeJson(wiPath, wi);

    const remaining = pendingOf(wi);
    return ok({
      work_item_id: workItemId,
      resolved,
      remaining_pending: remaining,
      formatted: formatAnswerResult(workItemId, resolved, remaining),
    });
  });
}

export const ANSWER_USAGE =
  'Usage: `answer <work-item-id> [<decision-id> "answer"]… [--force]` \u2014 omit answers to list pending decisions.';

export interface ParsedAnswerArgs {
  workItemId?: string;
  answers: DecisionAnswer[];
  force: boolean;
  list: boolean;
  errors: string[];
}

/**
 * Parses `<ID> [<decision-id> "answer"]… [--force] [--list]` from pre-tokenised args (shell
 * quoting already applied by the CLI, or {@link tokenizeArgs} for Pi's raw string).
 */
export function parseAnswerArgs(tokens: string[]): ParsedAnswerArgs {
  const parsed: ParsedAnswerArgs = { answers: [], force: false, list: false, errors: [] };
  const positional: string[] = [];
  for (const token of tokens) {
    if (token === "--force") parsed.force = true;
    else if (token === "--list") parsed.list = true;
    else if (token.startsWith("--")) parsed.errors.push(`Unknown flag ${token}.`);
    else positional.push(token);
  }
  parsed.workItemId = positional[0];
  const pairs = positional.slice(1);
  if (pairs.length % 2 !== 0) {
    parsed.errors.push(`Decision \`${pairs[pairs.length - 1]}\` has no answer.`);
  }
  for (let pairIndex = 0; pairIndex + 1 < pairs.length; pairIndex += 2) {
    parsed.answers.push({ id: pairs[pairIndex], answer: pairs[pairIndex + 1] });
  }
  if (pairs.length === 0) parsed.list = true;
  return parsed;
}

export type AnswerCommandResult =
  | { kind: "list"; value: PendingDecisionsResult }
  | { kind: "answer"; value: AnswerResult };

/** Shared entry for the CLI (tokens) and Pi (raw string via {@link devAnswer}). */
export function runAnswer(tokens: string[]): Result<AnswerCommandResult> {
  const parsed = parseAnswerArgs(tokens);
  if (!parsed.workItemId) return err(ANSWER_USAGE);
  if (parsed.errors.length > 0) return err(`${parsed.errors.join(" ")}\n${ANSWER_USAGE}`);
  if (parsed.list && parsed.answers.length === 0) {
    const listed = listPendingDecisions(parsed.workItemId);
    return listed.ok ? ok({ kind: "list", value: listed.value }) : listed;
  }
  const answered = answerDecisions(parsed.workItemId, parsed.answers, { force: parsed.force });
  return answered.ok ? ok({ kind: "answer", value: answered.value }) : answered;
}

/** `/dev answer …` entry point — same leading-work-item-id convention as `/dev block`. */
export function devAnswer(rawArgs: string): Result<AnswerCommandResult> {
  const { leadingWorkItemId } = parseKnownDevSubcommandArgs("answer", rawArgs);
  if (!leadingWorkItemId) return err(ANSWER_USAGE);
  return runAnswer(tokenizeArgs(rawArgs.trim()));
}
