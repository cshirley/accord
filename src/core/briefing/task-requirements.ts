/**
 * Task requirements slice — deterministic spec/plan excerpts for implementation
 * subagents (phase-test, phase-code, review-test, review-code).
 */

import * as path from "node:path";
import type { DevHarnessConfig } from "../config/index.js";
import type { PlanTaskStep } from "../plan/task-pipeline-profile.js";
import { resolveActivePrimaryTaskId } from "../orchestration/post-result/primary-task.js";
import { err, ok, type Result } from "../types/result.js";
import { loadWorkItem, readJson, workItemJsonPath, taskJsonPath } from "../work-items/io.js";
import {
  NONCE_SYNC_SPAWN_AGENTS,
  resolveOwnerNonce,
  syncTaskFileOwnerNonceForSpawn,
} from "./sync-task-owner-nonce.js";

export { NONCE_SYNC_SPAWN_AGENTS, resolveOwnerNonce, syncTaskFileOwnerNonceForSpawn };

export interface SliceTaskRequirementsOptions {
  /** Persist minted `owner_nonce` on the per-task file before phase-test / phase-code spawn. */
  syncBeforeSpawn?: { dispatchAgent: "phase-test" | "phase-code" };
}

/** Agents that receive a rich harness-built brief during implement / quick_fix resume. */
export const IMPLEMENT_SPAWN_AGENTS: ReadonlySet<string> = new Set([
  "phase-verify-task",
  "phase-test",
  "phase-code",
  "review-test",
  "review-security",
  "review-code",
]);

const IMPLEMENT_SPAWN_PATTERNS: ReadonlySet<string> = new Set(["implement", "quick_fix"]);

/** One-line summary for markdown briefs (scenario vs criterion AC shapes). */
export function formatAcceptanceCriterionLine(ac: Record<string, unknown>): string {
  const id = String(ac.id ?? "");
  const type = String(ac.type ?? "unknown");
  const text =
    typeof ac.scenario === "string" && ac.scenario.trim()
      ? ac.scenario
      : typeof ac.criterion === "string" && ac.criterion.trim()
        ? ac.criterion
        : typeof ac.requirement === "string"
          ? ac.requirement
          : JSON.stringify(ac);
  return `- **${id}** (${type}): ${text}`;
}

export interface TaskRequirementsSlice {
  work_item_id: string;
  task_id: number;
  owner_nonce: string;
  task_file_path: string;
  brief_path?: string;
  task: Record<string, unknown>;
  covered_acs: unknown[];
  test_cases: unknown[];
  test_files: string[];
  constraints: unknown[];
  resolved_questions: unknown[];
  scope_in: unknown[];
  scope_out: unknown[];
  rejected_alternatives: unknown[];
  guidance: unknown[];
  reuse_candidates: unknown[];
  verification_commands: string[];
  verify_steps?: string[];
  intent_contract?: {
    intent_mode?: string;
    escalation_ceiling?: string;
    target_paths?: string[];
    out_of_scope?: string[];
    expected_finish?: string;
  };
  quick_fix_contract?: unknown;
  red_confirmed?: boolean;
  test_output?: string;
  ac_covered?: string[];
  security_topology?: unknown;
}

export function filterCoveredAcceptanceCriteria(
  spec: Record<string, unknown>,
  coveredAcIds: string[],
): unknown[] {
  const criteria = (spec.acceptance_criteria as unknown[] | undefined) ?? [];
  return criteria.filter((ac) => coveredAcIds.includes(String((ac as Record<string, unknown>).id)));
}

export function filterTestCasesForAcIds(
  spec: Record<string, unknown>,
  coveredAcIds: string[],
): unknown[] {
  const verification = spec.verification as Record<string, unknown> | undefined;
  const allTestCases = (verification?.test_cases as unknown[] | undefined) ?? [];
  return allTestCases.filter((tc) => {
    const covers = (tc as Record<string, unknown>).covers;
    return typeof covers === "string" && coveredAcIds.includes(covers);
  });
}

export function sliceTaskRequirements(
  workItemId: string,
  taskId: number,
  config: DevHarnessConfig | null,
  options?: SliceTaskRequirementsOptions,
): Result<TaskRequirementsSlice> {
  const wi = loadWorkItem(workItemId);
  if (!wi) return err(`Work item not found: ${workItemId}`);

  const specPath = wi.spec;
  const planPath = wi.plan;
  if (!specPath || !planPath) {
    return err(`Spec or plan not set on work item ${workItemId}`);
  }

  const spec = readJson<Record<string, unknown>>(specPath);
  const plan = readJson<Record<string, unknown>>(planPath);
  if (!spec) return err(`Cannot read spec: ${specPath}`);
  if (!plan) return err(`Cannot read plan: ${planPath}`);

  const tasks = (plan.tasks as unknown[] | undefined) ?? [];
  const taskRaw = tasks.find((t) => String((t as Record<string, unknown>).id) === String(taskId));
  if (!taskRaw) return err(`Task ${String(taskId)} not found in plan`);
  const task = taskRaw as Record<string, unknown>;

  const coveredAcIds = (task.covers_ac as string[] | undefined) ?? [];
  const coveredAcs = filterCoveredAcceptanceCriteria(spec, coveredAcIds);
  const testCases = filterTestCasesForAcIds(spec, coveredAcIds);

  const taskFilePath = taskJsonPath(workItemId, String(taskId));
  let taskFile = readJson<Record<string, unknown>>(taskFilePath);
  const rawNonce = taskFile && typeof taskFile.owner_nonce === "string" ? taskFile.owner_nonce : "";
  const { ownerNonce, minted } = resolveOwnerNonce(rawNonce);

  const syncAgent = options?.syncBeforeSpawn?.dispatchAgent;
  if (syncAgent && NONCE_SYNC_SPAWN_AGENTS.has(syncAgent)) {
    const planSteps = (task.steps as PlanTaskStep[] | undefined) ?? [];
    const synced = syncTaskFileOwnerNonceForSpawn({
      workItemId,
      taskId,
      ownerNonce,
      minted,
      dispatchAgent: syncAgent,
      planTaskSteps: planSteps,
      taskFile,
    });
    if (!synced.ok) return synced;
    taskFile = readJson<Record<string, unknown>>(taskFilePath);
  }

  const testFiles = (Array.isArray(taskFile?.test_files) ? taskFile.test_files : []).filter(
    (f): f is string => typeof f === "string",
  );

  const scope = spec.scope as Record<string, unknown> | undefined;
  const verification = spec.verification as Record<string, unknown> | undefined;
  const verCmds =
    (verification?.commands as string[] | undefined) ?? config?.verification_commands ?? [];

  const planSteps = (task.steps as Array<{ tag?: string; description?: string }> | undefined) ?? [];
  const verifySteps = planSteps
    .filter((s) => s.tag === "verify")
    .map((s) => (typeof s.description === "string" ? s.description.trim() : ""))
    .filter((d) => d.length > 0);

  const intent_contract =
    wi.intent_mode ||
    wi.escalation_ceiling ||
    wi.target_paths?.length ||
    wi.out_of_scope?.length ||
    wi.expected_finish
      ? {
          ...(wi.intent_mode ? { intent_mode: wi.intent_mode } : {}),
          ...(wi.escalation_ceiling ? { escalation_ceiling: wi.escalation_ceiling } : {}),
          ...(wi.target_paths?.length ? { target_paths: wi.target_paths } : {}),
          ...(wi.out_of_scope?.length ? { out_of_scope: wi.out_of_scope } : {}),
          ...(wi.expected_finish ? { expected_finish: wi.expected_finish } : {}),
        }
      : undefined;

  return ok({
    work_item_id: workItemId,
    task_id: taskId,
    owner_nonce: ownerNonce,
    task_file_path: taskFilePath,
    ...(wi.brief ? { brief_path: wi.brief } : {}),
    task,
    covered_acs: coveredAcs,
    test_cases: testCases,
    test_files: testFiles,
    constraints: (spec.constraints as unknown[] | undefined) ?? [],
    resolved_questions: (spec.resolved_questions as unknown[] | undefined) ?? [],
    scope_in: (scope?.in as unknown[] | undefined) ?? [],
    scope_out: (scope?.out as unknown[] | undefined) ?? [],
    rejected_alternatives: (spec.rejected_alternatives as unknown[] | undefined) ?? [],
    guidance: (plan.guidance as unknown[] | undefined) ?? [],
    reuse_candidates: (plan.reuse_candidates as unknown[] | undefined) ?? [],
    verification_commands: verCmds,
    ...(verifySteps.length ? { verify_steps: verifySteps } : {}),
    ...(intent_contract ? { intent_contract } : {}),
    ...(taskFile?.quick_fix_contract !== undefined
      ? { quick_fix_contract: taskFile.quick_fix_contract }
      : {}),
    ...(taskFile?.red_confirmed === true ? { red_confirmed: true } : {}),
    ...(typeof taskFile?.test_output === "string" && taskFile.test_output.length > 0
      ? { test_output: taskFile.test_output }
      : {}),
    ...(Array.isArray(taskFile?.ac_covered)
      ? {
          ac_covered: (taskFile.ac_covered as unknown[]).filter(
            (id): id is string => typeof id === "string",
          ),
        }
      : {}),
    ...(spec.security_topology !== undefined
      ? { security_topology: spec.security_topology }
      : {}),
  });
}

/** Human-readable code-task brief (legacy `dev_code_brief` shape). */
export function formatCodeTaskBrief(slice: TaskRequirementsSlice): string {
  const s: string[] = [];

  s.push("## Code Task Brief");
  s.push("");
  s.push(`**work_item_id:** ${slice.work_item_id}`);
  s.push(`**task_id:** ${String(slice.task_id)}`);
  s.push(`**owner_nonce:** ${slice.owner_nonce}`);
  s.push(`**task_file_path:** ${slice.task_file_path}`);
  if (slice.brief_path) s.push(`**brief_path:** ${slice.brief_path}`);
  s.push("");

  if (slice.intent_contract) {
    s.push("### Intent Contract");
    s.push("");
    const ic = slice.intent_contract;
    if (ic.intent_mode) s.push(`- intent_mode: ${ic.intent_mode}`);
    if (ic.escalation_ceiling) s.push(`- escalation_ceiling: ${ic.escalation_ceiling}`);
    if (ic.target_paths?.length) s.push(`- target_paths: ${ic.target_paths.join(", ")}`);
    if (ic.out_of_scope?.length) s.push(`- out_of_scope: ${ic.out_of_scope.join(", ")}`);
    if (ic.expected_finish) s.push(`- expected_finish: ${ic.expected_finish}`);
    s.push("");
  }

  s.push("### Task");
  s.push("");
  s.push("```json");
  s.push(JSON.stringify(slice.task, null, 2));
  s.push("```");
  s.push("");

  s.push("### Covered Acceptance Criteria");
  s.push("");
  for (const ac of slice.covered_acs) {
    s.push(formatAcceptanceCriterionLine(ac as Record<string, unknown>));
  }
  s.push("");

  if (slice.test_cases.length) {
    s.push("### Test Cases");
    s.push("");
    s.push("```json");
    s.push(JSON.stringify(slice.test_cases, null, 2));
    s.push("```");
    s.push("");
  }

  if (slice.constraints.length) {
    s.push("### Constraints");
    s.push("");
    for (const c of slice.constraints) {
      s.push(
        `- ${typeof c === "string" ? c : String((c as Record<string, unknown>).constraint || JSON.stringify(c))}`,
      );
    }
    s.push("");
  }

  if (slice.resolved_questions.length) {
    s.push("### Resolved Questions");
    s.push("");
    for (const q of slice.resolved_questions) {
      const qr = q as Record<string, unknown>;
      s.push(`- **${qr.question || qr.id}**: ${qr.answer || qr.resolution}`);
    }
    s.push("");
  }

  if (slice.scope_in.length) {
    s.push("### Scope In");
    s.push("");
    for (const si of slice.scope_in) {
      s.push(
        `- ${typeof si === "string" ? si : String((si as Record<string, unknown>).item || JSON.stringify(si))}`,
      );
    }
    s.push("");
  }

  if (slice.scope_out.length) {
    s.push("### Scope Out");
    s.push("");
    for (const so of slice.scope_out) {
      const sor = so as Record<string, unknown>;
      s.push(`- ${typeof so === "string" ? so : `${sor.item}: ${sor.reason}`}`);
    }
    s.push("");
  }

  if (slice.rejected_alternatives.length) {
    s.push("### Rejected Alternatives");
    s.push("");
    for (const ra of slice.rejected_alternatives) {
      const r = ra as Record<string, unknown>;
      s.push(`- **${r.name}**: ${r.reason}`);
    }
    s.push("");
  }

  if (slice.guidance.length) {
    s.push("### Plan Guidance");
    s.push("");
    for (const g of slice.guidance) {
      const gr = g as Record<string, unknown>;
      s.push(`- [${gr.source}] ${gr.directive}`);
    }
    s.push("");
  }

  if (slice.reuse_candidates.length) {
    s.push("### Reuse Candidates");
    s.push("");
    for (const rc of slice.reuse_candidates) {
      const r = rc as Record<string, unknown>;
      s.push(`- ${r.path || r.symbol}: ${r.reason || r.note}`);
    }
    s.push("");
  }

  if (slice.verification_commands.length) {
    s.push("### Verification Commands");
    s.push("");
    for (const cmd of slice.verification_commands) s.push(`- \`${cmd}\``);
    s.push("");
  }

  if (slice.test_files.length) {
    s.push("### Test Files (from per-task file)");
    s.push("");
    for (const f of slice.test_files) s.push(`- ${f}`);
    s.push("");
  }

  return s.join("\n");
}

function agentPayloadForSpawn(
  agent: string,
  slice: TaskRequirementsSlice,
  options?: { preImplNote?: string },
): Record<string, unknown> {
  const base = {
    work_item_id: slice.work_item_id,
    task_id: slice.task_id,
    owner_nonce: slice.owner_nonce,
    task_file_path: slice.task_file_path,
    ...(slice.brief_path ? { brief_path: slice.brief_path } : {}),
    task: slice.task,
    covered_acs: slice.covered_acs,
    constraints: slice.constraints,
    resolved_questions: slice.resolved_questions,
    scope_in: slice.scope_in,
    scope_out: slice.scope_out,
    rejected_alternatives: slice.rejected_alternatives,
    guidance: slice.guidance,
    reuse_candidates: slice.reuse_candidates,
    verification_commands: slice.verification_commands,
    ...(slice.intent_contract ? { intent_contract: slice.intent_contract } : {}),
    ...(slice.quick_fix_contract !== undefined
      ? { quick_fix_contract: slice.quick_fix_contract }
      : {}),
  };

  if (agent === "phase-verify-task") {
    return {
      ...base,
      covered_acs: slice.covered_acs,
      verification_commands: slice.verification_commands,
      verify_steps: slice.verify_steps ?? [],
    };
  }

  if (agent === "phase-test") {
    return {
      ...base,
      test_cases: slice.test_cases,
    };
  }

  if (agent === "phase-code") {
    return {
      ...base,
      test_files: slice.test_files,
      ...(slice.red_confirmed ? { red_confirmed: true } : {}),
    };
  }

  if (agent === "review-test") {
    return {
      mode: "pre-impl",
      test_files: slice.test_files,
      production_files: [],
      test_output: slice.test_output ?? "",
      covered_acs: slice.covered_acs,
      test_cases: slice.test_cases,
      constraints: slice.constraints,
      scope_out: slice.scope_out,
      rejected_alternatives: slice.rejected_alternatives,
      task: slice.task,
      guidance: slice.guidance,
      ...(slice.ac_covered?.length ? { ac_covered: slice.ac_covered } : {}),
      ...(slice.red_confirmed ? { red_confirmed: true } : {}),
      ...(slice.quick_fix_contract !== undefined
        ? { quick_fix_contract: slice.quick_fix_contract }
        : {}),
      ...(options?.preImplNote ? { note: options.preImplNote } : {}),
    };
  }

  if (agent === "review-security") {
    return {
      ...base,
      security_topology: slice.security_topology,
    };
  }

  if (agent === "review-code") {
    return {
      ...base,
      test_files: slice.test_files,
    };
  }

  return base;
}

export function formatImplementSpawnTaskBrief(input: {
  agent: string;
  pattern: string;
  phase: string;
  title: string;
  variant?: string;
  slice: TaskRequirementsSlice;
  preImplNote?: string;
}): string {
  const pipelineLabel = input.pattern === "quick_fix" ? "quick fix" : "implement";
  const agentLabels: Record<string, string> = {
    "phase-verify-task": "phase-verify-task (verify-only gate)",
    "phase-test": "phase-test",
    "phase-code": "phase-code",
    "review-test": `review-test — ${pipelineLabel} (pre-impl)`,
    "review-security": "review-security",
    "review-code": "review-code",
  };
  const heading = agentLabels[input.agent] ?? input.agent;

  const payload = agentPayloadForSpawn(input.agent, input.slice, {
    ...(input.preImplNote ? { preImplNote: input.preImplNote } : {}),
  });

  const lines = [
    `## ${heading}`,
    "",
    "ACCORD harness orchestration built this brief from spec.json, plan.json, and the per-task file.",
    "",
    `**work_item_id:** ${input.slice.work_item_id}`,
    `**work_item_phase:** ${input.phase}`,
    `**dispatch_agent:** ${input.agent}`,
    `**title:** ${input.title}`,
    ...(input.variant ? [`**variant:** ${input.variant}`] : []),
    "",
    "### Task requirements (read fields below; open paths on disk as needed)",
    "",
    "```json",
    JSON.stringify(payload, null, 2),
    "```",
    "",
    "Return the structured result packet required by your agent contract.",
  ];
  return lines.join("\n");
}

/**
 * Rich spawn brief for implementation pipeline agents.
 * - `ok(null)` when spec/plan/task context is missing or review-test preconditions are not met.
 * - `err` when owner_nonce sync fails (drift) before phase-test / phase-code spawn.
 */
export function buildImplementSpawnTaskBrief(input: {
  workItemId: string;
  dispatchAgent: string;
  phase: string;
  title: string;
  pattern: string;
  variant?: string;
  devConfig: DevHarnessConfig | null;
}): Result<string | null> {
  if (!IMPLEMENT_SPAWN_AGENTS.has(input.dispatchAgent)) {
    return ok(null);
  }
  if (!IMPLEMENT_SPAWN_PATTERNS.has(input.pattern)) {
    return ok(null);
  }

  const wi = loadWorkItem(input.workItemId);
  if (!wi?.spec || !wi.plan) {
    return ok(null);
  }

  const taskId = resolveActivePrimaryTaskId(wi) ?? wi.task_ids[0] ?? 1;
  let syncBeforeSpawn: SliceTaskRequirementsOptions["syncBeforeSpawn"];
  if (input.dispatchAgent === "phase-test") {
    syncBeforeSpawn = { dispatchAgent: "phase-test" };
  } else if (input.dispatchAgent === "phase-code") {
    syncBeforeSpawn = { dispatchAgent: "phase-code" };
  }
  const sliced = sliceTaskRequirements(input.workItemId, taskId, input.devConfig, {
    ...(syncBeforeSpawn ? { syncBeforeSpawn } : {}),
  });
  if (!sliced.ok) {
    if (syncBeforeSpawn && sliced.error.includes("owner_nonce drift")) {
      return sliced;
    }
    return ok(null);
  }
  const slice = sliced.value;

  if (input.dispatchAgent === "review-test") {
    const testStrategy = (slice.quick_fix_contract as { test?: { strategy?: string } } | undefined)
      ?.test?.strategy;
    if (slice.test_files.length === 0 && testStrategy !== "no_test") {
      return ok(null);
    }
    const preImplNote =
      testStrategy === "no_test"
        ? "quick_fix_contract.test.strategy is no_test — review scope, stubs, and contract only (no new test files)."
        : undefined;
    return ok(
      formatImplementSpawnTaskBrief({
        agent: input.dispatchAgent,
        pattern: input.pattern,
        phase: input.phase,
        title: input.title,
        variant: input.variant,
        slice,
        preImplNote,
      }),
    );
  }

  if (input.dispatchAgent === "review-security") {
    return ok(
      formatImplementSpawnTaskBrief({
        agent: input.dispatchAgent,
        pattern: input.pattern,
        phase: input.phase,
        title: input.title,
        variant: input.variant,
        slice,
      }),
    );
  }

  return ok(
    formatImplementSpawnTaskBrief({
      agent: input.dispatchAgent,
      pattern: input.pattern,
      phase: input.phase,
      title: input.title,
      variant: input.variant,
      slice,
    }),
  );
}
