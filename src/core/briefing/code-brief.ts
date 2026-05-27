/**
 * Code brief assembly — builds the complete phase-code brief from
 * spec, plan, and task data without loading raw JSON into the
 * orchestrator's context window.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { syncSpecMarkdownFromJson } from "../artifacts/spec-markdown.js";
import type { DevHarnessConfig } from "../config/index.js";
import { readQuickFixLoopCounters } from "../orchestration/quick-fix.js";
import { err, ok, type Result } from "../types/result.js";
import { loadWorkItem, now, readJson, TASKS_DIR, writeJson } from "../work-items/io.js";
import { devNonce } from "./nonce.js";
import { formatCodeTaskBrief, sliceTaskRequirements } from "./task-requirements.js";

export { devNonce };

export function devCodeBrief(
  workItemId: string,
  taskId: string,
  config: DevHarnessConfig | null,
): Result<{ brief: string }> {
  const parsedId = Number.parseInt(taskId, 10);
  if (!Number.isFinite(parsedId) || parsedId < 1) {
    return err(`Invalid task id: ${taskId}`);
  }
  const sliced = sliceTaskRequirements(workItemId, parsedId, config);
  if (!sliced.ok) return sliced;
  return ok({ brief: formatCodeTaskBrief(sliced.value) });
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
  syncSpecMarkdownFromJson(specPath);
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
