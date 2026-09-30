/**
 * Shared handling for multi-turn phase agents returning `needs_input`.
 * Persists checkpoint, promotes questions to work-item decisions, and formats
 * a human-readable handoff for the orchestrator / end user.
 */

import { devCheckpointRead, devCheckpointWrite } from "../../work-items/checkpoint.js";
import { loadWorkItem, now, workItemJsonPath, writeJson } from "../../work-items/io.js";
import type { Decision, WorkItem } from "../../work-items/types.js";

export interface InterviewQuestion {
  id: string;
  text: string;
  /** `topic` (phase-spec) or `stage` (phase-plan) when present. */
  label?: string;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

export function isNeedsInputPacket(packet: unknown): boolean {
  return asRecord(packet)?.status === "needs_input";
}

/**
 * `phase-spec`/`phase-plan` self-report `questions[]` (`id`/`text`/`topic|stage`).
 * `phase-align` has no `questions[]` \u2014 its reflective loop instead emits `reflections[]`
 * (`id`/`text`/`type`, where `type` is `reflection|probe|assumption`) for the user to react to.
 * Both shapes are close enough (id + text + optional label) to promote identically.
 */
export function parseInterviewQuestions(packet: unknown): InterviewQuestion[] {
  const record = asRecord(packet);
  const source = Array.isArray(record?.questions)
    ? record.questions
    : Array.isArray(record?.reflections)
      ? record.reflections
      : undefined;
  if (!source) {
    return [];
  }
  const parsed: InterviewQuestion[] = [];
  for (const raw of source) {
    const q = asRecord(raw);
    const id = typeof q?.id === "string" ? q.id.trim() : "";
    const text = typeof q?.text === "string" ? q.text.trim() : "";
    if (!id || !text) {
      continue;
    }
    const topic = typeof q?.topic === "string" ? q.topic.trim() : "";
    const stage = typeof q?.stage === "string" ? q.stage.trim() : "";
    const type = typeof q?.type === "string" ? q.type.trim() : "";
    parsed.push({ id, text, label: topic || stage || type || undefined });
  }
  return parsed;
}

function mergeAnsweredIds(existing: string[] | undefined, resolved: string[]): string[] {
  const set = new Set(existing ?? []);
  for (const id of resolved) {
    if (id) set.add(id);
  }
  return [...set];
}

function decisionAnswerById(wi: WorkItem): Map<string, string> {
  const map = new Map<string, string>();
  for (const d of wi.decisions ?? []) {
    if (d.status !== "resolved") {
      continue;
    }
    const answer = typeof d.answer === "string" ? d.answer.trim() : "";
    if (answer) {
      map.set(d.id, answer);
    }
  }
  return map;
}

export function buildAnsweredMapForInterview(workItemId: string): Record<string, string> {
  const wi = loadWorkItem(workItemId);
  if (!wi) {
    return {};
  }
  const answers = decisionAnswerById(wi);
  const out: Record<string, string> = {};
  for (const [id, answer] of answers) {
    out[id] = answer;
  }
  const cp = devCheckpointRead(workItemId);
  for (const id of cp?.answered ?? []) {
    if (!(id in out)) {
      out[id] = "";
    }
  }
  return out;
}

export function promoteInterviewQuestionsToDecisions(
  workItemId: string,
  coarsePhase: string,
  agent: string,
  questions: InterviewQuestion[],
): number {
  if (questions.length === 0) {
    return 0;
  }
  const wi = loadWorkItem(workItemId);
  if (!wi) {
    return 0;
  }

  const source: Decision["source"] =
    agent === "phase-plan"
      ? "plan"
      : agent === "phase-spec"
        ? "spec"
        : agent === "phase-align"
          ? "align"
          : "escalation";

  const existingIds = new Set((wi.decisions ?? []).map((d) => d.id));
  let added = 0;
  const timestamp = now();

  for (const q of questions) {
    if (existingIds.has(q.id)) {
      continue;
    }
    wi.decisions.push({
      id: q.id,
      source,
      status: "pending",
      question: q.label ? `[${q.label}] ${q.text}` : q.text,
      context: `ACCORD ${agent} interview (${coarsePhase})`,
      phase: coarsePhase,
      asked_at: timestamp,
    });
    existingIds.add(q.id);
    added++;
  }

  if (added > 0) {
    wi.updated = timestamp;
    writeJson(workItemJsonPath(workItemId), wi);
  }

  return added;
}

export interface PersistInterviewCheckpointResult {
  checkpointPath: string;
  pendingIds: string[];
}

export function persistInterviewCheckpoint(
  workItemId: string,
  coarsePhase: string,
  packet: unknown,
): PersistInterviewCheckpointResult | null {
  if (!isNeedsInputPacket(packet)) {
    return null;
  }

  const record = asRecord(packet);
  // phase-spec/phase-plan self-report a `draft` object directly; phase-align has no `draft`
  // field \u2014 its evolving state is `brief`/`markers`/`convergence`, so pack those into `draft`
  // (the checkpoint schema only constrains `draft` to be *an* object, not its inner shape).
  const draft =
    record?.draft ??
    (record?.brief || record?.markers || record?.convergence
      ? { brief: record?.brief, markers: record?.markers, convergence: record?.convergence }
      : {});
  const questions = parseInterviewQuestions(packet);
  const pendingIds = questions.map((q) => q.id);

  const wi = loadWorkItem(workItemId);
  const resolvedFromDecisions = wi ? [...decisionAnswerById(wi).keys()] : [];
  const prior = devCheckpointRead(workItemId);
  const answered = mergeAnsweredIds(
    [...(prior?.answered ?? []), ...resolvedFromDecisions],
    [],
  ).filter((id) => !pendingIds.includes(id));

  const { path } = devCheckpointWrite(workItemId, {
    schema_version: "1.0",
    work_item_id: workItemId,
    phase: coarsePhase,
    draft,
    answered,
    pending: pendingIds,
  });

  return { checkpointPath: path, pendingIds };
}

export function formatNeedsInputHandoff(input: {
  agent: string;
  workItemId: string;
  coarsePhase: string;
  questions: InterviewQuestion[];
  checkpointPath: string;
  decisionsAdded: number;
}): string {
  const wiPath = workItemJsonPath(input.workItemId);
  const lines = [
    "",
    `⏸ **${input.agent} needs your input** (${input.coarsePhase}).`,
    "",
    `Checkpoint written: \`${input.checkpointPath}\``,
    ...(input.decisionsAdded > 0
      ? [
          `Promoted ${String(input.decisionsAdded)} question(s) to the decision queue in \`${wiPath}\` (\`decisions[]\`) — that file is the source of truth for answers.`,
        ]
      : []),
    "",
    "**Questions:**",
  ];

  for (const q of input.questions) {
    const label = q.label ? `**${q.label}** — ` : "";
    lines.push(`- \`${q.id}\`: ${label}${q.text}`);
  }

  lines.push(
    "",
    "In Pi: reply in chat or run `/dev review " +
      input.workItemId +
      "`, then `/dev resume " +
      input.workItemId +
      "`.",
    `Headless: \`accord answer ${input.workItemId} <id> "answer" [<id> "answer"]…\` for each id above, then \`accord resume ${input.workItemId}\`.`,
    "",
    "The checkpoint's `answered`/`pending` lists are a derived cache re-synced from `decisions[]` on the agent's next turn; editing `decisions[]` is sufficient.",
  );

  return lines.join("\n");
}

export function applyInterviewNeedsInputPostResult(
  workItemId: string,
  agent: string,
  coarsePhase: string,
  packet: unknown,
): string {
  if (!isNeedsInputPacket(packet)) {
    return "";
  }

  const questions = parseInterviewQuestions(packet);
  const persisted = persistInterviewCheckpoint(workItemId, coarsePhase, packet);
  if (!persisted) {
    return "";
  }

  const decisionsAdded = promoteInterviewQuestionsToDecisions(
    workItemId,
    coarsePhase,
    agent,
    questions,
  );

  return formatNeedsInputHandoff({
    agent,
    workItemId,
    coarsePhase,
    questions,
    checkpointPath: persisted.checkpointPath,
    decisionsAdded,
  });
}
