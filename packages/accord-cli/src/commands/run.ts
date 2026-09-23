/**
 * `accord run` — classify + bootstrap + full workflow drive (free-text entry).
 */

import {
  classifyPreflight,
  resolveWorkItemIdFromClassifyText,
} from "@clive.shirley/accord-core/commands/classify-dispatch.js";
import { loadWorkItem } from "@clive.shirley/accord-core/work-items/io.js";
import type { CliContext } from "../context.js";
import type { AgentHarness } from "../harnesses/types.js";
import { cliNotify } from "../notify.js";
import { type DriveWorkflowOptions, type DriveWorkflowResult, runDriveWorkflow } from "./drive.js";

export type RunWorkflowResult = DriveWorkflowResult & {
  intent_block?: string;
  bootstrap_notice?: string;
};

export type RunWorkflowOptions = DriveWorkflowOptions & {
  json?: boolean;
};

export async function runClassifyAndDriveWorkflow(
  ctx: CliContext,
  harness: AgentHarness,
  text: string,
  options: RunWorkflowOptions = {},
): Promise<RunWorkflowResult> {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      workItemId: "",
      status: "blocked",
      rounds: 0,
      exitCode: 1,
      message: "Usage: accord run <ticket-or-description>",
    };
  }

  const pre = classifyPreflight(trimmed);
  cliNotify("info", pre.intentBlock);
  if (pre.bootstrapNotice) {
    cliNotify("info", pre.bootstrapNotice);
  }

  const workItemId = resolveWorkItemIdFromClassifyText(trimmed);
  if (!workItemId) {
    const hint = pre.intent.needs_confirmation
      ? "Intent needs confirmation — include a ticket id (e.g. ACCORD-1234) or run dev_bootstrap via MCP."
      : "No ticket-shaped work item id in input. Use: accord run ACCORD-1234 <title> or accord drive <ID>.";
    return {
      workItemId: "",
      status: "blocked",
      rounds: 0,
      exitCode: 1,
      message: hint,
      intent_block: pre.intentBlock,
      bootstrap_notice: pre.bootstrapNotice,
    };
  }

  if (!loadWorkItem(workItemId)) {
    return {
      workItemId,
      status: "blocked",
      rounds: 0,
      exitCode: 1,
      message: `Work item ${workItemId} was not bootstrapped. ${pre.bootstrapNotice ?? "Check intent confidence or bootstrap manually."}`,
      intent_block: pre.intentBlock,
      bootstrap_notice: pre.bootstrapNotice,
    };
  }

  const drive = await runDriveWorkflow(ctx, harness, workItemId, options);
  return {
    ...drive,
    intent_block: pre.intentBlock,
    bootstrap_notice: pre.bootstrapNotice,
  };
}

export async function runRunCommand(
  ctx: CliContext,
  harness: AgentHarness,
  text: string,
  options: RunWorkflowOptions,
): Promise<number> {
  const result = await runClassifyAndDriveWorkflow(ctx, harness, text, options);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result.exitCode;
  }

  if (result.message) {
    const level =
      result.status === "finished" || result.status === "ready_for_finish" ? "info" : "warning";
    cliNotify(level === "info" ? "info" : "warning", result.message);
  }

  return result.exitCode;
}

export async function runDriveCommand(
  ctx: CliContext,
  harness: AgentHarness,
  workItemId: string,
  options: RunWorkflowOptions,
): Promise<number> {
  const result = await runDriveWorkflow(ctx, harness, workItemId, options);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return result.exitCode;
  }

  if (result.message) {
    const level =
      result.status === "finished" || result.status === "ready_for_finish" ? "info" : "warning";
    cliNotify(level === "info" ? "info" : "warning", result.message);
  }

  return result.exitCode;
}
