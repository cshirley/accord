/**
 * Exec harness command templates and task file staging.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { ASSETS_DIR, CORE_DIR } from "@clive.shirley/accord-core/config/paths.js";
import { buildOutboundTaskText } from "@clive.shirley/accord-core/subagent/response-contract.js";
import type { PreparedSingleSubagentInput } from "@clive.shirley/accord-core/subagent/run-request.js";

export type ExecTemplateVars = {
  agent: string;
  agentId: string;
  agentFile: string;
  assetsDir: string;
  cwd: string;
  schemasDir: string;
  systemAppend: string;
  systemAppendFile: string;
  task: string;
  taskFile: string;
};

const TEMPLATE_TOKENS: Array<keyof ExecTemplateVars> = [
  "agentId",
  "agentFile",
  "assetsDir",
  "schemasDir",
  "systemAppendFile",
  "taskFile",
  "agent",
  "systemAppend",
  "task",
  "cwd",
];

export function renderExecCommandArg(arg: string, vars: ExecTemplateVars): string {
  let rendered = arg;
  for (const key of TEMPLATE_TOKENS) {
    rendered = rendered.replaceAll(`{{${key}}}`, vars[key]);
  }
  return rendered;
}

export function renderExecCommand(command: string[], vars: ExecTemplateVars): string[] {
  return command.map((arg) => renderExecCommandArg(arg, vars));
}

export function writeExecStagingFile(
  cwd: string,
  subdir: string,
  agent: string,
  suffix: string,
  content: string,
): string {
  const dir = path.join(cwd, ".tasks", ".exec-spawn", subdir);
  fs.mkdirSync(dir, { recursive: true });
  const safeAgent = agent.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const filePath = path.join(dir, `${String(Date.now())}-${safeAgent}${suffix}`);
  fs.writeFileSync(filePath, content, "utf8");
  return filePath;
}

export function writeExecTaskFile(cwd: string, agent: string, task: string): string {
  return writeExecStagingFile(cwd, "tasks", agent, ".md", task);
}

export function writeExecSystemAppendFile(
  cwd: string,
  agent: string,
  systemAppend: string,
): string {
  return writeExecStagingFile(cwd, "system", agent, ".md", systemAppend);
}

export function buildExecOutboundTask(prepared: PreparedSingleSubagentInput): string {
  return buildOutboundTaskText(prepared.task, prepared.response);
}

export function resolveExecTemplateVars(
  cwd: string,
  prepared: PreparedSingleSubagentInput,
): ExecTemplateVars {
  const outboundTask = buildExecOutboundTask(prepared);
  const taskFile = writeExecTaskFile(cwd, prepared.agent, outboundTask);
  const systemAppend = prepared.systemAppend?.trim() ?? "";
  const systemAppendFile = systemAppend
    ? writeExecSystemAppendFile(cwd, prepared.agent, systemAppend)
    : "";

  return {
    agent: prepared.agent,
    agentId: prepared.agent,
    agentFile: prepared.agentFile ?? "",
    assetsDir: ASSETS_DIR,
    schemasDir: path.join(CORE_DIR, "schemas"),
    systemAppend,
    systemAppendFile,
    task: outboundTask,
    taskFile,
    cwd: path.resolve(cwd),
  };
}
