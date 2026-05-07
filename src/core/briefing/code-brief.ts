/**
 * Code brief assembly — builds the complete phase-code brief from
 * spec, plan, and task data without loading raw JSON into the
 * orchestrator's context window.
 */

import * as path from "node:path";
import { randomBytes } from "node:crypto";
import type { DevHarnessConfig } from "../config/index.js";
import { TASKS_DIR, readJson, loadWorkItem, writeJson, now } from "../work-items/io.js";

export function devCodeBrief(
  workItemId: string,
  taskId: string,
  config: DevHarnessConfig | null,
): { brief: string } | { error: string } {
  const wi = loadWorkItem(workItemId);
  if (!wi) return { error: `Work item not found: ${workItemId}` };

  const specPath = wi.spec;
  const planPath = wi.plan;
  if (!specPath || !planPath) return { error: `Spec or plan not set on work item ${workItemId}` };

  const spec = readJson<any>(specPath);
  const plan = readJson<any>(planPath);
  if (!spec) return { error: `Cannot read spec: ${specPath}` };
  if (!plan) return { error: `Cannot read plan: ${planPath}` };

  const task = (plan.tasks || []).find((t: any) => String(t.id) === String(taskId));
  if (!task) return { error: `Task ${taskId} not found in plan` };

  const coveredAcIds = task.covers_ac || [];
  const coveredAcs = (spec.acceptance_criteria || []).filter((ac: any) =>
    coveredAcIds.includes(ac.id),
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

  if (wi.intent_mode || wi.escalation_ceiling || wi.target_paths?.length || wi.out_of_scope?.length || wi.expected_finish) {
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
  for (const ac of coveredAcs) s.push(`- **${ac.id}** (${ac.type}): ${ac.criterion}`);
  s.push("");

  if (spec.constraints?.length) {
    s.push("### Constraints");
    s.push("");
    for (const c of spec.constraints) s.push(`- ${typeof c === "string" ? c : c.constraint || JSON.stringify(c)}`);
    s.push("");
  }

  if (spec.resolved_questions?.length) {
    s.push("### Resolved Questions");
    s.push("");
    for (const q of spec.resolved_questions) s.push(`- **${q.question || q.id}**: ${q.answer || q.resolution}`);
    s.push("");
  }

  if (spec.scope?.in?.length) {
    s.push("### Scope In");
    s.push("");
    for (const si of spec.scope.in) s.push(`- ${typeof si === "string" ? si : si.item || JSON.stringify(si)}`);
    s.push("");
  }

  if (spec.scope?.out?.length) {
    s.push("### Scope Out");
    s.push("");
    for (const so of spec.scope.out) s.push(`- ${typeof so === "string" ? so : `${so.item}: ${so.reason}`}`);
    s.push("");
  }

  if (spec.rejected_alternatives?.length) {
    s.push("### Rejected Alternatives");
    s.push("");
    for (const ra of spec.rejected_alternatives) s.push(`- **${ra.name}**: ${ra.reason}`);
    s.push("");
  }

  if (plan.guidance?.length) {
    s.push("### Plan Guidance");
    s.push("");
    for (const g of plan.guidance) s.push(`- [${g.source}] ${g.directive}`);
    s.push("");
  }

  if (plan.reuse_candidates?.length) {
    s.push("### Reuse Candidates");
    s.push("");
    for (const rc of plan.reuse_candidates) s.push(`- ${rc.path || rc.symbol}: ${rc.reason || rc.note}`);
    s.push("");
  }

  const verCmds = spec.verification?.commands || config?.verification_commands || [];
  if (verCmds.length) {
    s.push("### Verification Commands");
    s.push("");
    for (const cmd of verCmds) s.push(`- \`${cmd}\``);
    s.push("");
  }

  return { brief: s.join("\n") };
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
  const verificationCommands = config?.verification_commands ?? [
    config?.type_check,
    config?.test?.command,
  ].filter(Boolean) as string[];

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
      in: contract.plan.target_paths.length > 0
        ? contract.plan.target_paths
        : [wi.title],
      out: contract.plan.out_of_scope.map((item) => ({
        item,
        reason: "Out of scope for this quick fix",
      })),
    },
    verification: {
      commands: verificationCommands,
      test_cases: contract.test.strategy === "no_test" ? [] : [
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
        files: targetFiles.length > 0
          ? targetFiles
          : [{ path: "TBD", action: "modify" as const }],
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

function quickFixContract(workItem: { title: string; expected_finish?: string; target_paths?: string[]; out_of_scope?: string[] }, config: DevHarnessConfig | null): QuickFixContract {
  const text = `${workItem.title} ${workItem.expected_finish ?? ""} ${(workItem.target_paths ?? []).join(" ")}`.toLowerCase();
  const testCommand = config?.test?.command ?? config?.verification_commands?.find((cmd) => /\b(test|spec|pytest|go test|cargo test|bun test|npm test)\b/i.test(cmd));
  const docsOnly = (workItem.target_paths ?? []).length > 0 && (workItem.target_paths ?? []).every((p) => /\.(md|mdx|txt|adoc|rst)$/i.test(p) || /(^|\/)(readme|docs?)\//i.test(p));
  const mechanical = /\b(typo|wording|copy|comment|comments|docs?|readme|prompt|skill text|agent text|formatting)\b/.test(text);

  let strategy: QuickFixTestStrategy = "new_red_test";
  let reason: string | undefined;
  if (!testCommand) {
    strategy = "no_test";
    reason = "No project test command is configured.";
  } else if (docsOnly || mechanical) {
    strategy = "no_test";
    reason = docsOnly ? "Documentation-only quick fix." : "Mechanical or content-only quick fix.";
  } else if (/\b(existing test|failing test|test failure|make tests pass|red already)\b/.test(text)) {
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

export function devQuickFixBrief(
  workItemId: string,
  config: DevHarnessConfig | null,
): { brief: string; task_file_path: string; task_id: string; brief_type: "phase-test" | "phase-code" } | { error: string } {
  const wi = loadWorkItem(workItemId);
  if (!wi) return { error: `Work item not found: ${workItemId}` };
  if (wi.pattern !== "quick_fix") return { error: `Work item ${workItemId} is not a quick_fix item` };

  const taskId = "1";
  const taskFilePath = path.join(TASKS_DIR, `${workItemId}-task-${taskId}.json`);
  const existingTask = readJson<any>(taskFilePath);
  const ownerNonce = /^[0-9a-f]{6}$/.test(existingTask?.owner_nonce || "")
    ? existingTask.owner_nonce
    : devNonce();
  const contract = quickFixContract(wi, config);
  const needsTestPhase = contract.test.strategy === "new_red_test";

  const { specPath, planPath } = writeQuickFixStubs(workItemId, wi, contract, config);

  const taskFile = {
    schema_version: "1.0",
    work_item_id: workItemId,
    task_id: 1,
    owner_nonce: ownerNonce,
    phase: needsTestPhase ? "phase-test" : "phase-code",
    status: existingTask?.status === "done" ? "done" : "pending",
    pre_impl_gates: needsTestPhase ? "pending" : "complete",
    test_files: Array.isArray(existingTask?.test_files) ? existingTask.test_files : [],
    red_confirmed: existingTask?.red_confirmed === true,
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

  const verificationCommands = config?.verification_commands ?? [
    config?.type_check,
    config?.test?.command,
  ].filter(Boolean) as string[];

  const s: string[] = [];

  if (needsTestPhase) {
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
    s.push(`Write one narrow regression test that demonstrates the bug or missing behaviour described by \`expected_finish\`.`);
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
    if ("error" in codeBrief) return codeBrief;

    s.push(codeBrief.brief);
    s.push("");
    s.push("### Quick Fix Rules");
    s.push("");
    s.push("- This quick_fix item skips the full spec/plan agents. The spec and plan are auto-generated stubs.");
    s.push("- Read `quick_fix_contract` from the per-task file before editing.");
    s.push("- Modify only the contract target paths when target_paths are provided.");
    s.push("- Use `quick_fix_contract.plan.expected_finish` as the definition of done.");
    s.push("- Follow `quick_fix_contract.test.strategy` exactly and keep the per-task file schema-valid.");
    s.push("");
    s.push("### Quick Fix Contract");
    s.push("");
    s.push("```json");
    s.push(JSON.stringify(contract, null, 2));
    s.push("```");
    s.push("");
  }

  return { brief: s.join("\n"), task_file_path: taskFilePath, task_id: taskId, brief_type: needsTestPhase ? "phase-test" : "phase-code" };
}
