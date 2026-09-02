/**
 * Exec harness command templates and task file staging.
 */

import * as fs from "node:fs";
import * as path from "node:path";

export type ExecTemplateVars = {
  agent: string;
  agentId: string;
  task: string;
  taskFile: string;
  cwd: string;
};

const TEMPLATE_TOKENS: Array<keyof ExecTemplateVars> = [
  "agentId",
  "taskFile",
  "agent",
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

export function writeExecTaskFile(cwd: string, agent: string, task: string): string {
  const dir = path.join(cwd, ".tasks", ".exec-spawn");
  fs.mkdirSync(dir, { recursive: true });
  const safeAgent = agent.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const filePath = path.join(dir, `${String(Date.now())}-${safeAgent}.md`);
  fs.writeFileSync(filePath, task, "utf8");
  return filePath;
}

export function resolveExecTemplateVars(
  cwd: string,
  agent: string,
  task: string,
  taskFile?: string,
): ExecTemplateVars {
  const resolvedTaskFile = taskFile ?? writeExecTaskFile(cwd, agent, task);
  return {
    agent,
    agentId: agent,
    task,
    taskFile: resolvedTaskFile,
    cwd: path.resolve(cwd),
  };
}
