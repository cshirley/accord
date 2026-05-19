/**
 * Code brief assembly — builds the complete phase-code brief from
 * spec, plan, and task data without loading raw JSON into the
 * orchestrator's context window.
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import type { DevHarnessConfig } from "../config/index.js";
import { readQuickFixLoopCounters } from "../orchestration/quick-fix.js";
import { err, ok, type Result } from "../types/result.js";
import { loadWorkItem, now, readJson, TASKS_DIR, writeJson } from "../work-items/io.js";

export function devCodeBrief(
  workItemId: string,
  taskId: string,
  config: DevHarnessConfig | null,
): Result<{ brief: string }> {
  const wi = loadWorkItem(workItemId);
  if (!wi) return err(`Work item not found: ${workItemId}`);

  const specPath = wi.spec;
  const planPath = wi.plan;
  if (!specPath || !planPath) return err(`Spec or plan not set on work item ${workItemId}`);

  const spec = readJson<Record<string, unknown>>(specPath);
  const plan = readJson<Record<string, unknown>>(planPath);
  if (!spec) return err(`Cannot read spec: ${specPath}`);
  if (!plan) return err(`Cannot read plan: ${planPath}`);

  const tasks = (plan.tasks as unknown[] | undefined) ?? [];
  const taskRaw = tasks.find((t) => String((t as Record<string, unknown>).id) === String(taskId));
  if (!taskRaw) return err(`Task ${taskId} not found in plan`);
  const task = taskRaw as Record<string, unknown>;

  const coveredAcIds = (task.covers_ac as string[] | undefined) ?? [];
  const criteria = (spec.acceptance_criteria as unknown[] | undefined) ?? [];
  const coveredAcs = criteria.filter((ac) =>
    coveredAcIds.includes(String((ac as Record<string, unknown>).id)),
  );

  const nonce = randomBytes(3).toString("hex");
  const s: string[] = [];

  s.push("## Code Task Brief");
  s.push("");
  s.push(`**work_item_id:** ${workItemId}`);
  s.push(`**task_id:** ${taskId}`);
  s.push(`**owner_nonce:** ${nonce}`);
  s.push(`**task_file_path:** ${path.join(TASKS_DIR, `${workItemId}-task-${taskId}.json`)}`);
  if (wi.brief) s.push(`**brief_path:** ${wi.brief}`);
  s.push("");

  if (
    wi.intent_mode ||
    wi.escalation_ceiling ||
    wi.target_paths?.length ||
    wi.out_of_scope?.length ||
    wi.expected_finish
  ) {
    s.push("### Intent Contract");
    s.push("");
    if (wi.intent_mode) s.push(`- intent_mode: ${wi.intent_mode}`);
    if (wi.escalation_ceiling) s.push(`- escalation_ceiling: ${wi.escalation_ceiling}`);
    if (wi.target_paths?.length) s.push(`- target_paths: ${wi.target_paths.join(", ")}`);
    if (wi.out_of_scope?.length) s.push(`- out_of_scope: ${wi.out_of_scope.join(", ")}`);
    if (wi.expected_finish) s.push(`- expected_finish: ${wi.expected_finish}`);
    s.push("");
  }

  s.push("### Task");
  s.push("");
  s.push("```json");
  s.push(JSON.stringify(task, null, 2));
  s.push("```");
  s.push("");

  s.push("### Covered Acceptance Criteria");
  s.push("");
  for (const ac of coveredAcs) {
    const a = ac as Record<string, unknown>;
    s.push(`- **${a.id}** (${a.type}): ${a.criterion}`);
  }
  s.push("");

  const constraints = (spec.constraints as unknown[] | undefined) ?? [];
  if (constraints.length) {
    s.push("### Constraints");
    s.push("");
    for (const c of constraints)
      s.push(
        `- ${typeof c === "string" ? c : String((c as Record<string, unknown>).constraint || JSON.stringify(c))}`,
      );
    s.push("");
  }

  const resolvedQuestions = (spec.resolved_questions as unknown[] | undefined) ?? [];
  if (resolvedQuestions.length) {
    s.push("### Resolved Questions");
    s.push("");
    for (const q of resolvedQuestions) {
      const qr = q as Record<string, unknown>;
      s.push(`- **${qr.question || qr.id}**: ${qr.answer || qr.resolution}`);
    }
    s.push("");
  }

  const scope = spec.scope as Record<string, unknown> | undefined;
  const scopeIn = (scope?.in as unknown[] | undefined) ?? [];
  if (scopeIn.length) {
    s.push("### Scope In");
    s.push("");
    for (const si of scopeIn)
      s.push(
        `- ${typeof si === "string" ? si : String((si as Record<string, unknown>).item || JSON.stringify(si))}`,
      );
    s.push("");
  }

  const scopeOutItems = (scope?.out as unknown[] | undefined) ?? [];
  if (scopeOutItems.length) {
    s.push("### Scope Out");
    s.push("");
    for (const so of scopeOutItems) {
      const sor = so as Record<string, unknown>;
      s.push(`- ${typeof so === "string" ? so : `${sor.item}: ${sor.reason}`}`);
    }
    s.push("");
  }

  const rejectedAlternatives = (spec.rejected_alternatives as unknown[] | undefined) ?? [];
  if (rejectedAlternatives.length) {
    s.push("### Rejected Alternatives");
    s.push("");
    for (const ra of rejectedAlternatives) {
      const r = ra as Record<string, unknown>;
      s.push(`- **${r.name}**: ${r.reason}`);
    }
    s.push("");
  }

  const guidance = (plan.guidance as unknown[] | undefined) ?? [];
  if (guidance.length) {
    s.push("### Plan Guidance");
    s.push("");
    for (const g of guidance) {
      const gr = g as Record<string, unknown>;
      s.push(`- [${gr.source}] ${gr.directive}`);
    }
    s.push("");
  }

  const reuseCandidates = (plan.reuse_candidates as unknown[] | undefined) ?? [];
  if (reuseCandidates.length) {
    s.push("### Reuse Candidates");
    s.push("");
    for (const rc of reuseCandidates) {
      const r = rc as Record<string, unknown>;
      s.push(`- ${r.path || r.symbol}: ${r.reason || r.note}`);
    }
    s.push("");
  }

  const verification = spec.verification as Record<string, unknown> | undefined;
  const verCmds =
    (verification?.commands as string[] | undefined) ?? config?.verification_commands ?? [];
  if (verCmds.length) {
    s.push("### Verification Commands");
    s.push("");
    for (const cmd of verCmds) s.push(`- \`${cmd}\``);
    s.push("");
  }

  return ok({ brief: s.join("\n") });
}

export function devNonce(): string {
  return randomBytes(3).toString("hex");
}

type QuickFixTestStrategy = "existing_tests" | "new_red_test" | "no_test";

interface QuickFixContract {
  plan: {
    summary: string;
    target_paths: string[];
    out_of_scope: string[];
    expected_finish: string;
  };
  test: {
    strategy: QuickFixTestStrategy;
    command?: string;
    red_required: boolean;
    reason?: string;
  };
}

function writeQuickFixStubs(
  workItemId: string,
  wi: { title: string; expected_finish?: string; target_paths?: string[]; out_of_scope?: string[] },
  contract: QuickFixContract,
  config: DevHarnessConfig | null,
): { specPath: string; planPath: string } {
  const today = new Date().toISOString().split("T")[0];
  const verificationCommands =
    config?.verification_commands ??
    ([config?.type_check, config?.test?.command].filter(Boolean) as string[]);

  const specPath = path.join("docs", "dev", workItemId, "spec.json");
  const planPath = path.join("docs", "dev", workItemId, "plan.json");

  const spec = {
    schema_version: "1.0" as const,
    work_item_id: workItemId,
    title: wi.title,
    date: today,
    problem_statement: wi.title,
    proposed_solution: contract.plan.expected_finish,
    acceptance_criteria: [
      {
        id: "AC-1",
        requirement: "MUST" as const,
        type: "scenario" as const,
        scenario: contract.plan.expected_finish,
      },
    ],
    scope: {
      in: contract.plan.target_paths.length > 0 ? contract.plan.target_paths : [wi.title],
      out: contract.plan.out_of_scope.map((item) => ({
        item,
        reason: "Out of scope for this quick fix",
      })),
    },
    verification: {
      commands: verificationCommands,
      test_cases:
        contract.test.strategy === "no_test"
          ? []
          : [
              {
                id: "TC-1",
                covers: "AC-1",
                scenario: contract.plan.expected_finish,
                tier: "unit" as const,
              },
            ],
    },
  };

  const targetFiles = (wi.target_paths ?? []).map((p) => ({
    path: p,
    action: "modify" as const,
  }));

  const plan = {
    schema_version: "1.0" as const,
    work_item_id: workItemId,
    spec: specPath,
    tasks: [
      {
        id: 1,
        title: wi.title,
        covers_ac: ["AC-1"],
        challenge: false,
        files: targetFiles.length > 0 ? targetFiles : [{ path: "TBD", action: "modify" as const }],
        steps: [
          {
            tag: "impl" as const,
            description: contract.plan.expected_finish,
          },
        ],
      },
    ],
  };

  writeJson(specPath, spec);
  writeJson(planPath, plan);
  return { specPath, planPath };
}

function quickFixContract(
  workItem: {
    title: string;
    expected_finish?: string;
    target_paths?: string[];
    out_of_scope?: string[];
  },
  config: DevHarnessConfig | null,
): QuickFixContract {
  const text =
    `${workItem.title} ${workItem.expected_finish ?? ""} ${(workItem.target_paths ?? []).join(" ")}`.toLowerCase();
  const testCommand =
    config?.test?.command ??
    config?.verification_commands?.find((cmd) =>
      /\b(test|spec|pytest|go test|cargo test|bun test|npm test)\b/i.test(cmd),
    );
  const docsOnly =
    (workItem.target_paths ?? []).length > 0 &&
    (workItem.target_paths ?? []).every(
      (p) => /\.(md|mdx|txt|adoc|rst)$/i.test(p) || /(^|\/)(readme|docs?)\//i.test(p),
    );
  const mechanical =
    /\b(typo|wording|copy|comment|comments|docs?|readme|prompt|skill text|agent text|formatting)\b/.test(
      text,
    );

  let strategy: QuickFixTestStrategy = "new_red_test";
  let reason: string | undefined;
  if (!testCommand) {
    strategy = "no_test";
    reason = "No project test command is configured.";
  } else if (docsOnly || mechanical) {
    strategy = "no_test";
    reason = docsOnly ? "Documentation-only quick fix." : "Mechanical or content-only quick fix.";
  } else if (
    /\b(existing test|failing test|test failure|make tests pass|red already)\b/.test(text)
  ) {
    strategy = "existing_tests";
    reason = "The request appears to target an existing failing test or regression.";
  }

  return {
    plan: {
      summary: workItem.title,
      target_paths: workItem.target_paths ?? [],
      out_of_scope: workItem.out_of_scope ?? [],
      expected_finish: workItem.expected_finish ?? workItem.title,
    },
    test: {
      strategy,
      command: testCommand,
      red_required: strategy === "new_red_test",
      reason,
    },
  };
}

export interface QuickFixBrief {
  brief: string;
  brief_path: string;
  task_file_path: string;
  task_id: string;
  brief_type: "phase-test" | "review-test" | "phase-code";
}

export function devQuickFixBrief(
  workItemId: string,
  config: DevHarnessConfig | null,
): Result<QuickFixBrief> {
  const wi = loadWorkItem(workItemId);
  if (!wi) return err(`Work item not found: ${workItemId}`);
  if (wi.pattern !== "quick_fix") return err(`Work item ${workItemId} is not a quick_fix item`);

  const taskId = "1";
  const taskFilePath = path.join(TASKS_DIR, `${workItemId}-task-${taskId}.json`);
  const existingTask = readJson<Record<string, unknown>>(taskFilePath);
  const rawNonce =
    existingTask && typeof existingTask.owner_nonce === "string" ? existingTask.owner_nonce : "";
  const ownerNonce = /^[0-9a-f]{6}$/.test(rawNonce) ? rawNonce : devNonce();
  const contract = quickFixContract(wi, config);
  const needsTestPhase =
    contract.test.strategy === "new_red_test" || contract.test.strategy === "existing_tests";
  const startsAtReviewTest = contract.test.strategy === "no_test";

  const { specPath, planPath } = writeQuickFixStubs(workItemId, wi, contract, config);

  const loopCounters = readQuickFixLoopCounters(
    existingTask && typeof existingTask === "object"
      ? (existingTask as Record<string, unknown>)
      : {},
  );

  const taskFile = {
    schema_version: "1.0",
    work_item_id: workItemId,
    task_id: 1,
    owner_nonce: ownerNonce,
    phase: needsTestPhase ? "phase-test" : startsAtReviewTest ? "review-test" : "phase-code",
    status: existingTask?.status === "done" ? "done" : "pending",
    pre_impl_gates: needsTestPhase || startsAtReviewTest ? "pending" : "complete",
    test_files: Array.isArray(existingTask?.test_files) ? existingTask.test_files : [],
    red_confirmed: existingTask?.red_confirmed === true,
    quick_fix_loop: { test_review_cycles_used: loopCounters.test_review_cycles_used },
    quick_fix_contract: contract,
    events: Array.isArray(existingTask?.events) ? existingTask.events : [],
  };
  writeJson(taskFilePath, taskFile);

  if (!wi.task_ids.includes(1)) wi.task_ids.push(1);
  wi.phase = "fixing";
  wi.spec = specPath;
  wi.plan = planPath;
  wi.updated = now();
  writeJson(path.join(TASKS_DIR, `${workItemId}.json`), wi);

  const _verificationCommands =
    config?.verification_commands ??
    ([config?.type_check, config?.test?.command].filter(Boolean) as string[]);

  const s: string[] = [];

  if (startsAtReviewTest) {
    s.push("## Quick Fix — review-test (pre-impl, no new tests)");
    s.push("");
    s.push(`**work_item_id:** ${workItemId}`);
    s.push(`**task_id:** ${taskId}`);
    s.push(`**owner_nonce:** ${ownerNonce}`);
    s.push(`**task_file_path:** ${taskFilePath}`);
    s.push("");
    s.push(
      "This quick_fix item uses `test.strategy: no_test`. Run **review-test** (pre-impl) on the stubs and contract before implementation.",
    );
    s.push("");
    s.push("### Quick Fix Contract");
    s.push("");
    s.push("```json");
    s.push(JSON.stringify(contract, null, 2));
    s.push("```");
    s.push("");
  } else if (needsTestPhase) {
    s.push("## Quick Fix Test Brief");
    s.push("");
    s.push(`**work_item_id:** ${workItemId}`);
    s.push(`**task_id:** ${taskId}`);
    s.push(`**owner_nonce:** ${ownerNonce}`);
    s.push(`**task_file_path:** ${taskFilePath}`);
    s.push("");
    s.push("### Context");
    s.push("");
    s.push("This is a quick_fix item with auto-generated spec/plan stubs.");
    s.push(
      `Write one narrow regression test that demonstrates the bug or missing behaviour described by \`expected_finish\`.`,
    );
    s.push("Confirm the test is RED (fails) before implementation.");
    s.push("");
    s.push("### Covered Acceptance Criteria");
    s.push("");
    s.push(`- **AC-1** (scenario): ${contract.plan.expected_finish}`);
    s.push("");
    s.push("### Intent Contract");
    s.push("");
    if (wi.intent_mode) s.push(`- intent_mode: ${wi.intent_mode}`);
    if (wi.target_paths?.length) s.push(`- target_paths: ${wi.target_paths.join(", ")}`);
    if (wi.expected_finish) s.push(`- expected_finish: ${wi.expected_finish}`);
    s.push("");
    s.push("### Quick Fix Contract");
    s.push("");
    s.push("```json");
    s.push(JSON.stringify(contract, null, 2));
    s.push("```");
    s.push("");
    if (config?.test?.command) {
      s.push("### Verification Commands");
      s.push("");
      s.push(`- \`${config.test.command}\``);
      if (config.test.file_pattern) s.push(`- file pattern: \`${config.test.file_pattern}\``);
      s.push("");
    }
  } else {
    const codeBrief = devCodeBrief(workItemId, taskId, config);
    if (!codeBrief.ok) return codeBrief;

    s.push(codeBrief.value.brief);
    s.push("");
    s.push("### Quick Fix Rules");
    s.push("");
    s.push(
      "- This quick_fix item skips the full spec/plan agents. The spec and plan are auto-generated stubs.",
    );
    s.push("- Read `quick_fix_contract` from the per-task file before editing.");
    s.push("- Modify only the contract target paths when target_paths are provided.");
    s.push("- Use `quick_fix_contract.plan.expected_finish` as the definition of done.");
    s.push(
      "- Follow `quick_fix_contract.test.strategy` exactly and keep the per-task file schema-valid.",
    );
    s.push("");
    s.push("### Quick Fix Contract");
    s.push("");
    s.push("```json");
    s.push(JSON.stringify(contract, null, 2));
    s.push("```");
    s.push("");
  }

  const briefContent = s.join("\n");
  const briefPath = path.join("docs", "dev", workItemId, "brief.md");
  mkdirSync(path.dirname(briefPath), { recursive: true });
  writeFileSync(briefPath, briefContent, "utf8");
  wi.brief = briefPath;
  wi.updated = now();
  writeJson(path.join(TASKS_DIR, `${workItemId}.json`), wi);

  return ok({
    brief: briefContent,
    brief_path: briefPath,
    task_file_path: taskFilePath,
    task_id: taskId,
    brief_type: needsTestPhase ? "phase-test" : startsAtReviewTest ? "review-test" : "phase-code",
  });
}
