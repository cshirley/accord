/**
 * Command catalog for help, completion, and interactive mode.
 */

import { WORKFLOW_SUBCOMMANDS } from "../commands/workflow.js";

export type CommandSpec = {
  name: string;
  summary: string;
  usage?: string;
  needsWorkItem?: boolean;
  aliases?: string[];
};

export const TOP_LEVEL_COMMANDS: CommandSpec[] = [
  { name: "help", summary: "Full harness help" },
  { name: "tasks", summary: "Work item dashboard", usage: "tasks [--select]" },
  { name: "retro", summary: "Retrospective insights" },
  { name: "tag", summary: "Tag active work item", usage: "tag [<label>]" },
  { name: "rehydrate", summary: "Rebuild work item from artifacts", needsWorkItem: true },
  { name: "spec-gaps", summary: "Spec gap report", needsWorkItem: true },
  { name: "gaps", summary: "Implementation gap report", needsWorkItem: true },
  { name: "deviations", summary: "Deviation review", needsWorkItem: true },
  { name: "run", summary: "Bootstrap from ticket or description", usage: "run <text>" },
  { name: "drive", summary: "Drive work item loop", needsWorkItem: true },
  { name: "plan", summary: "Orchestration plan or phase-plan workflow", usage: "plan <resume|finish|ID>" },
  { name: "resume", summary: "Resume orchestration", needsWorkItem: true },
  { name: "finish", summary: "Finish closeout", needsWorkItem: true },
  { name: "init", summary: "Stack detect + AGENTS.md bootstrap" },
  { name: "config", summary: "Global config", usage: "config init" },
  { name: "review", summary: "Standalone diff review" },
  { name: "completion", summary: "Shell completion scripts", usage: "completion <bash|zsh>" },
  ...WORKFLOW_SUBCOMMANDS.map((name) => ({
    name,
    summary: `Workflow phase: ${name}`,
    needsWorkItem: true,
  })),
];

export const WORK_ITEM_ACTIONS = ["resume", "finish", "drive", "plan", "align", "spec", "check", "gaps"] as const;

export function allCommandNames(): string[] {
  const names = new Set<string>();
  for (const command of TOP_LEVEL_COMMANDS) {
    names.add(command.name);
    for (const alias of command.aliases ?? []) names.add(alias);
  }
  return [...names].sort();
}

export function commandNeedsWorkItem(command: string): boolean {
  return TOP_LEVEL_COMMANDS.some((spec) => spec.name === command && spec.needsWorkItem);
}

export function matchCommands(prefix: string): string[] {
  const normalized = prefix.trim().toLowerCase();
  if (!normalized) return allCommandNames();
  return allCommandNames().filter((name) => name.startsWith(normalized));
}

export function matchWorkItems(prefix: string, ids: string[]): string[] {
  const normalized = prefix.trim();
  if (!normalized) return ids;
  const lower = normalized.toLowerCase();
  return ids.filter((id) => id.toLowerCase().startsWith(lower));
}
