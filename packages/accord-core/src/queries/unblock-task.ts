/**
 * `/dev unblock` / `accord unblock` — resolve a blocked task **per blocker**.
 *
 * Every human decision is recorded in the finding's `history` and the log, so the next agent
 * round sees it:
 *
 *   --note   F-n "…"   guidance for the fixer (finding stays gating)
 *   --fixed  F-n "…"   human fixed it; the raiser rechecks it next round
 *   --accept F-n "…"   accept the agent's wont_fix / dispute (no longer gating)
 *   --waive  F-n|AC-n "…"  waive a finding or a whole requirement
 *   --force  "…"       allow a blind unblock (nothing decided, nothing changed)
 *
 * Outcomes for a retry-cap block:
 * - nothing left gating → the loop gate passes (advance as a clean decision); **no** unblock
 *   budget used and counters untouched
 * - gating remains → reset that loop's `used` counter, `unblocks += 1`, open the next round
 *   (fixer, or the reviewer when every remaining blocker was `--fixed` by the human)
 * Refusals: lifetime cap, `max_unblocks_per_task` exhausted, blind unblock without `--force`.
 */

import { loadDevHarnessConfig } from "../config/index.js";
import type { DevHarnessConfig } from "../config/types.js";
import { worktreeFingerprintSync } from "../git/helpers.js";
import {
  maxUnblocksPerTaskFromDevConfig,
  verifyLoopPolicyFromDevConfig,
} from "../orchestration/policy.js";
import { capForKey, RETRY_KEY_FOR_LOOP, type RetryKey } from "../tasks/decide.js";
import {
  allocateRef,
  appendLog,
  applyHumanDecision,
  gatingFindings,
  type HumanAction,
  type HumanDecision,
  openRound,
  refreshTask,
} from "../tasks/model.js";
import { logDecision } from "../tasks/record.js";
import { legacyTaskFileMessage, loadTaskResult, writeTaskV2 } from "../tasks/store.js";
import type { LoopKind, TaskFileV2 } from "../tasks/types.js";
import { err, ok, type Result } from "../types/result.js";
import { loadWorkItem, now, taskLockPath, withJsonFileLock } from "../work-items/io.js";

export type { HumanDecision };

export interface UnblockOptions {
  decisions?: HumanDecision[];
  /** Reason for bypassing the blind-unblock guard. */
  force?: string;
  /** Test seam: working-tree fingerprint provider. */
  fingerprint?: () => string | null;
}

export interface UnblockedTaskSummary {
  task_id: number;
  was_status: string;
  /** `advanced` (gate passed), `retry` (counters reset), `resumed` (crash/manual/stuck), `decided` (not blocked). */
  outcome: "advanced" | "retry" | "resumed" | "decided";
  decisions: string[];
  next_phase: string;
  round: string;
  retries_reset: Partial<Record<RetryKey, number>>;
  unblock_count: number;
  remaining_blockers: string[];
}

export interface UnblockResult {
  work_item_id: string;
  unblocked: UnblockedTaskSummary[];
  formatted: string;
}

type UnblockOneResult =
  | { kind: "ok"; summary: UnblockedTaskSummary }
  | { kind: "skip" }
  | { kind: "error"; message: string };

function loopOfBlock(task: TaskFileV2): LoopKind {
  const loop = task.control.blocked?.loop;
  if (loop === "rgr") return "T";
  if (loop === "T" || loop === "C" || loop === "V") return loop;
  const phase = task.control.phase;
  if (phase === "phase-test" || phase === "review-test") return "T";
  if (phase === "phase-verify-task") return "V";
  return "C";
}

/** Advance as if the blocked loop's gate had passed (all blockers accepted/waived). */
function advancePastGate(
  task: TaskFileV2,
  loop: LoopKind,
  rgr: boolean,
  at: string,
  devConfig: DevHarnessConfig | null,
): string {
  if (rgr) {
    // phase-code finished; its test issues were resolved by the human → continue the C round.
    task.control.phase = "review-code";
    logDecision(task, at, {
      result: "advance",
      note: "Test issues resolved by human → review-code",
      next_phase: "review-code",
    });
    return "review-code";
  }
  if (loop === "T") {
    task.control.phase = "phase-code";
    task.control.pre_impl_gates = "complete";
    logDecision(
      task,
      at,
      {
        result: "advance",
        note: "Blockers resolved by human → phase-code",
        next_phase: "phase-code",
      },
      "C",
    );
    return "phase-code";
  }
  if (loop === "C" && verifyLoopPolicyFromDevConfig(devConfig).enabled) {
    task.control.phase = "phase-verify-task";
    logDecision(
      task,
      at,
      {
        result: "advance",
        note: "Blockers resolved by human → phase-verify-task",
        next_phase: "phase-verify-task",
      },
      "V",
    );
    return "phase-verify-task";
  }
  task.control.status = "done";
  logDecision(task, at, { result: "done", note: "Blockers resolved by human → done" });
  return task.control.phase;
}

function allFindingsIn(task: TaskFileV2, loop: LoopKind) {
  return task.requirements
    .filter((req) => !req.waived)
    .flatMap((req) => req.findings)
    .filter((finding) => finding.loop === loop && !finding.advisory);
}

function unblockOne(
  workItemId: string,
  taskId: number,
  options: UnblockOptions,
  devConfig: DevHarnessConfig | null,
): UnblockOneResult {
  return withJsonFileLock(taskLockPath(workItemId), () => {
    const loaded = loadTaskResult(workItemId, taskId);
    if (loaded.kind === "missing") {
      return { kind: "error", message: `Task ${String(taskId)} not found on ${workItemId}.` };
    }
    if (loaded.kind === "legacy") {
      return { kind: "error", message: legacyTaskFileMessage(workItemId, taskId) };
    }
    const task = loaded.task;
    const wi = loadWorkItem(workItemId);
    const pattern = wi?.pattern ?? "implement";
    const at = now();
    const decisions = options.decisions ?? [];
    const wasStatus = task.control.status;

    if (wasStatus !== "blocked" && decisions.length === 0) return { kind: "skip" };

    // 1. Apply decisions.
    const unblockRef = allocateRef(task, "unblock");
    const applied: string[] = [];
    for (const decision of decisions) {
      const result = applyHumanDecision(task, decision, unblockRef);
      if (!result.ok) return { kind: "error", message: result.error };
      applied.push(`${decision.action} ${decision.target}`);
    }
    refreshTask(task, at);

    const summaryBase = {
      task_id: taskId,
      was_status: wasStatus,
      decisions: applied,
      retries_reset: {} as Partial<Record<RetryKey, number>>,
    };

    if (wasStatus !== "blocked") {
      appendLog(task, {
        ref: unblockRef,
        at,
        result: "decided",
        note: applied.join("; "),
        actor: "human",
      });
      writeTaskV2(task, at);
      return {
        kind: "ok",
        summary: {
          ...summaryBase,
          outcome: "decided",
          next_phase: task.control.phase,
          round: task.control.round,
          unblock_count: task.control.retries.unblocks,
          remaining_blockers: task.summary.blockers.map((b) => b.finding),
        },
      };
    }

    const block = task.control.blocked;
    const logUnblock = (result: string, extra: string) =>
      appendLog(task, {
        ref: unblockRef,
        at,
        result,
        note: [applied.join("; "), extra].filter(Boolean).join(" — "),
        actor: "human",
      });

    // 2. Non-cap blocks (crash / manual / stuck): release and resume.
    if (block?.kind !== "cap") {
      logUnblock("resumed", block ? `${block.kind}: ${block.reason}` : "");
      task.control.status = "pending";
      task.control.blocked = null;
      task.control.in_flight = null;
      if (block?.kind === "crash") {
        openRound(task, loopOfBlock(task));
      }
      writeTaskV2(task, at);
      return {
        kind: "ok",
        summary: {
          ...summaryBase,
          outcome: "resumed",
          next_phase: task.control.phase,
          round: task.control.round,
          unblock_count: task.control.retries.unblocks,
          remaining_blockers: task.summary.blockers.map((b) => b.finding),
        },
      };
    }

    // 3. Retry-cap block.
    const rgr = block.loop === "rgr";
    const loop = loopOfBlock(task);
    const key: RetryKey = rgr ? "rgr" : RETRY_KEY_FOR_LOOP[loop];
    const gating = gatingFindings(task, [loop]);
    // Findings the human marked fixed must still be rechecked by their reviewer.
    const humanFixed = allFindingsIn(task, loop).filter(
      (finding) =>
        finding.history.at(-1)?.by === unblockRef && finding.history.at(-1)?.outcome === "fixed",
    );

    if (gating.length === 0 && humanFixed.length === 0) {
      logUnblock("advanced", "all blockers resolved");
      task.control.status = "pending";
      task.control.blocked = null;
      const next = advancePastGate(task, loop, rgr, at, devConfig);
      writeTaskV2(task, at);
      return {
        kind: "ok",
        summary: {
          ...summaryBase,
          outcome: "advanced",
          next_phase: next,
          round: task.control.round,
          unblock_count: task.control.retries.unblocks,
          remaining_blockers: [],
        },
      };
    }

    const remaining = [
      ...gating.map(({ finding }) => finding.id),
      ...humanFixed.map((finding) => finding.id),
    ];
    const cap = capForKey(key, devConfig, pattern);
    if (task.control.retries[key].lifetime >= cap.maxLifetimeRetries) {
      return {
        kind: "error",
        message:
          `Task ${String(taskId)} on ${workItemId}: ${key} LIFETIME cap reached (${String(cap.maxLifetimeRetries)}). ` +
          `Unblock cannot reset it — --accept/--waive the remaining blockers (${remaining.join(", ")}) or raise the lifetime cap in config.`,
      };
    }
    const maxUnblocks = maxUnblocksPerTaskFromDevConfig(devConfig);
    if (task.control.retries.unblocks >= maxUnblocks) {
      return {
        kind: "error",
        message:
          `Task ${String(taskId)} on ${workItemId} has used its unblock budget (${String(task.control.retries.unblocks)}/${String(maxUnblocks)}; orchestration.review_loop.max_unblocks_per_task). ` +
          `--accept/--waive the remaining blockers (${remaining.join(", ")}), fix them for real, or raise the cap deliberately.`,
      };
    }

    const decidedTargets = new Set(decisions.map((decision) => decision.target));
    const anyDecided = remaining.some((id) => decidedTargets.has(id)) || humanFixed.length > 0;
    if (!anyDecided && !options.force) {
      const fingerprint = (options.fingerprint ?? (() => worktreeFingerprintSync()))();
      if (block.fingerprint && fingerprint && fingerprint === block.fingerprint) {
        return {
          kind: "error",
          message:
            `Blind unblock refused for task ${String(taskId)} on ${workItemId}: blockers ${remaining.join(", ")} have no decision and nothing changed since the block. ` +
            'Add --note/--fixed/--accept/--waive per blocker, change the code, or pass --force "reason".',
        };
      }
    }

    // Reset only the blocked loop's counter; lifetime counters survive.
    summaryBase.retries_reset[key] = task.control.retries[key].used;
    task.control.retries[key].used = 0;
    task.control.retries.unblocks += 1;
    // Every remaining blocker was fixed by the human → go straight to the reviewer's recheck.
    const allHumanFixed = gating.length === 0;
    const forceNote = options.force ? `forced: ${options.force}` : "";
    logUnblock("retry", [`${key} used reset`, forceNote].filter(Boolean).join("; "));
    task.control.status = "pending";
    task.control.blocked = null;
    task.control.in_flight = null;
    openRound(task, loop);
    if (rgr || loop === "T") {
      task.control.pre_impl_gates = "pending";
      task.control.phase = allHumanFixed ? "review-test" : "phase-test";
    } else if (loop === "C") {
      task.control.phase = allHumanFixed ? "review-code" : "phase-code";
    } else {
      // Verify failures are fixed by phase-code in a code round, then re-verified.
      if (allHumanFixed) {
        task.control.phase = "phase-verify-task";
      } else {
        openRound(task, "C");
        task.control.phase = "phase-code";
      }
    }
    writeTaskV2(task, at);
    return {
      kind: "ok",
      summary: {
        ...summaryBase,
        outcome: "retry",
        next_phase: task.control.phase,
        round: task.control.round,
        unblock_count: task.control.retries.unblocks,
        remaining_blockers: remaining,
      },
    };
  });
}

function formatUnblockResult(workItemId: string, unblocked: UnblockedTaskSummary[]): string {
  if (unblocked.length === 0) {
    return `${workItemId}: no blocked task(s) to unblock.`;
  }
  const lines = [`${workItemId}: ${String(unblocked.length)} task(s) updated.`, ""];
  for (const summary of unblocked) {
    const resetBits = Object.entries(summary.retries_reset)
      .map(([key, value]) => `${key}=${String(value)}→0`)
      .join(", ");
    const outcome =
      summary.outcome === "advanced"
        ? "all blockers resolved — gate passed (no unblock budget used)"
        : summary.outcome === "retry"
          ? `retry round ${summary.round}${resetBits ? ` (${resetBits})` : ""}; ${String(summary.remaining_blockers.length)} blocker(s) remain: ${summary.remaining_blockers.join(", ")}`
          : summary.outcome === "resumed"
            ? "released"
            : "decisions recorded";
    lines.push(
      `  task ${String(summary.task_id)}: ${summary.was_status} → ${summary.next_phase} — ${outcome}`,
    );
    if (summary.decisions.length) lines.push(`    decisions: ${summary.decisions.join("; ")}`);
  }
  lines.push(
    "",
    `Run \`/dev resume ${workItemId}\` (or \`accord resume ${workItemId}\`) to continue.`,
  );
  return lines.join("\n");
}

/**
 * Unblocks a specific task (`taskId` given) or every currently-blocked task on the work item
 * (`taskId` omitted; decisions require an explicit task).
 */
export function unblockTask(
  workItemId: string,
  taskId?: number,
  options: UnblockOptions = {},
): Result<UnblockResult> {
  const wi = loadWorkItem(workItemId);
  if (!wi) {
    return err(`Work item not found: ${workItemId}`);
  }
  const devConfig = loadDevHarnessConfig();

  if (taskId !== undefined) {
    const result = unblockOne(workItemId, taskId, options, devConfig);
    if (result.kind === "error") return err(result.message);
    if (result.kind === "skip") {
      const loaded = loadTaskResult(workItemId, taskId);
      const status = loaded.kind === "ok" ? loaded.task.control.status : "unknown";
      return err(`Task ${String(taskId)} on ${workItemId} is not blocked (status: ${status}).`);
    }
    return ok({
      work_item_id: workItemId,
      unblocked: [result.summary],
      formatted: formatUnblockResult(workItemId, [result.summary]),
    });
  }

  if (options.decisions?.length) {
    return err("Decisions (--note/--fixed/--accept/--waive) need an explicit task: --task <n>.");
  }

  const unblocked: UnblockedTaskSummary[] = [];
  const errors: string[] = [];
  for (const id of (wi.task_ids ?? []).map(Number)) {
    const result = unblockOne(workItemId, id, options, devConfig);
    if (result.kind === "ok") unblocked.push(result.summary);
    else if (result.kind === "error") errors.push(result.message);
  }
  const formatted = [formatUnblockResult(workItemId, unblocked), ...errors]
    .filter(Boolean)
    .join("\n\n");
  return ok({ work_item_id: workItemId, unblocked, formatted });
}

// ── Argument parsing (shared by /dev unblock and accord unblock) ─────

/** Shell-like tokenizer: whitespace-separated, single/double quotes group. */
export function tokenizeArgs(raw: string): string[] {
  const tokens: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  for (const match of raw.matchAll(re)) {
    tokens.push(match[1] !== undefined ? match[1].replace(/\\"/g, '"') : (match[2] ?? match[3]));
  }
  return tokens;
}

const DECISION_FLAGS: Record<string, HumanAction> = {
  "--note": "note",
  "--fixed": "fixed",
  "--accept": "accept",
  "--waive": "waive",
};

export interface ParsedUnblockArgs {
  workItemId?: string;
  taskId?: number;
  decisions: HumanDecision[];
  force?: string;
  errors: string[];
}

export function parseUnblockArgs(tokens: string[]): ParsedUnblockArgs {
  const parsed: ParsedUnblockArgs = { decisions: [], errors: [] };
  const positional: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const action = DECISION_FLAGS[token];
    if (action) {
      const target = tokens[index + 1];
      const reason = tokens[index + 2];
      if (!target || !/^(F-\d+|AC-\d+|QF|_task)$/.test(target)) {
        parsed.errors.push(`${token} needs a target (F-n or AC-n).`);
        index += 1;
        continue;
      }
      if (!reason || reason.startsWith("--")) {
        parsed.errors.push(`${token} ${target} needs a quoted reason.`);
        index += 1;
        continue;
      }
      parsed.decisions.push({ target, action, reason });
      index += 2;
      continue;
    }
    if (token === "--task") {
      const value = Number.parseInt(tokens[index + 1] ?? "", 10);
      if (!Number.isFinite(value)) parsed.errors.push("--task needs a number.");
      else parsed.taskId = value;
      index += 1;
      continue;
    }
    if (token === "--force") {
      const reason = tokens[index + 1];
      if (!reason || reason.startsWith("--")) parsed.errors.push("--force needs a quoted reason.");
      else parsed.force = reason;
      index += 1;
      continue;
    }
    positional.push(token);
  }
  if (positional[0]) parsed.workItemId = positional[0];
  if (positional[1] !== undefined && parsed.taskId === undefined) {
    const value = Number.parseInt(positional[1], 10);
    if (!Number.isFinite(value)) parsed.errors.push("task_id must be a number.");
    else parsed.taskId = value;
  }
  return parsed;
}

export const UNBLOCK_USAGE =
  'Usage: `/dev unblock <work-item-id> [task_id|--task n] [--note|--fixed|--accept|--waive F-n|AC-n "reason"]... [--force "reason"]`';

/** `/dev unblock …` entry point. */
export function devUnblock(rawArgs: string): Result<UnblockResult> {
  const parsed = parseUnblockArgs(tokenizeArgs(rawArgs.trim()));
  if (!parsed.workItemId) return err(UNBLOCK_USAGE);
  if (parsed.errors.length) return err(`${parsed.errors.join(" ")}\n${UNBLOCK_USAGE}`);
  return unblockTask(parsed.workItemId, parsed.taskId, {
    decisions: parsed.decisions,
    ...(parsed.force ? { force: parsed.force } : {}),
  });
}
