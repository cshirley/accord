/**
 * Minimal argv parser for `accord` CLI (no extra deps).
 */

import path from "node:path";
import { DEV_WORK_ITEM_ID_PATTERN } from "@clive.shirley/accord-core/commands/dispatch.js";
import type { WriteTarget } from "@clive.shirley/accord-core/config/init-write.js";
import type { PlanCommand } from "./commands/plan.js";
import { WORKFLOW_SUBCOMMANDS, type WorkflowSubcommand } from "./commands/workflow.js";

export type GlobalOptions = {
  cwd: string;
  harness: string | undefined;
  json: boolean;
  yes: boolean;
  help: boolean;
};

export type InitOptions = GlobalOptions & {
  write: boolean;
  target: WriteTarget | undefined;
};

export type ParsedCli =
  | { kind: "help" }
  | { kind: "tasks"; options: GlobalOptions }
  | { kind: "plan"; command: PlanCommand; workItemId: string; options: GlobalOptions }
  | {
      kind: "workflow";
      subcommand: WorkflowSubcommand;
      workItemId: string;
      rawArgs: string;
      options: GlobalOptions;
    }
  | { kind: "resume"; workItemId: string; options: GlobalOptions }
  | { kind: "finish"; workItemId: string; options: GlobalOptions }
  | { kind: "init"; options: InitOptions }
  | { kind: "review"; options: GlobalOptions }
  | { kind: "error"; message: string };

const HELP = `accord — standalone ACCORD orchestrator

Usage:
  accord tasks [--json]
  accord plan <resume|finish> <work-item-id> [--json]
  accord align|spec|plan|check <work-item-id> [--harness pi|exec] [--cwd DIR] [-y]
  accord resume <work-item-id> [--harness pi|exec] [--cwd DIR] [-y]
  accord finish <work-item-id> [--harness pi|exec] [--cwd DIR] [-y]
  accord init [--json] [--write [--target local|root|root_replace|link_only]]
  accord review [--harness pi|exec] [--cwd DIR] [--json]

Options:
  --harness <id>   Agent runtime backend (default: pi)
  --cwd <dir>      Project root (default: process.cwd())
  --json           Machine-readable output
  -y, --yes        Auto-confirm gather preflight prompts
  -h, --help       Show this help
`;

export function printHelp(): void {
  console.log(HELP.trim());
}

const INIT_TARGETS = new Set<WriteTarget>(["local", "root", "root_replace", "link_only"]);

function parseGlobalFlags(argv: string[]): { flags: GlobalOptions; rest: string[] } {
  const flags: GlobalOptions = {
    cwd: process.cwd(),
    harness: undefined,
    json: false,
    yes: false,
    help: false,
  };
  const rest: string[] = [];

  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === "--json") {
      flags.json = true;
    } else if (token === "-y" || token === "--yes") {
      flags.yes = true;
    } else if (token === "-h" || token === "--help") {
      flags.help = true;
    } else if (token === "--cwd") {
      const next = argv[++index];
      if (!next) throw new Error("--cwd requires a directory path");
      flags.cwd = path.resolve(next);
    } else if (token.startsWith("--cwd=")) {
      flags.cwd = path.resolve(token.slice("--cwd=".length));
    } else if (token === "--harness") {
      const next = argv[++index];
      if (!next) throw new Error("--harness requires pi or exec");
      flags.harness = next;
    } else if (token.startsWith("--harness=")) {
      flags.harness = token.slice("--harness=".length);
    } else {
      rest.push(token);
    }
  }

  return { flags, rest };
}

function parseInitFlags(flags: GlobalOptions, tail: string[]): InitOptions {
  const init: InitOptions = { ...flags, write: false, target: undefined };

  for (let index = 0; index < tail.length; index++) {
    const token = tail[index];
    if (token === "--write") {
      init.write = true;
    } else if (token === "--target") {
      const next = tail[++index];
      if (!next || !INIT_TARGETS.has(next as WriteTarget)) {
        throw new Error("--target requires local, root, root_replace, or link_only");
      }
      init.target = next as WriteTarget;
      init.write = true;
    } else if (token.startsWith("--target=")) {
      const value = token.slice("--target=".length);
      if (!INIT_TARGETS.has(value as WriteTarget)) {
        throw new Error("--target requires local, root, root_replace, or link_only");
      }
      init.target = value as WriteTarget;
      init.write = true;
    } else {
      throw new Error(`Unknown init flag: ${token}`);
    }
  }

  return init;
}

export function parseCli(argv: string[]): ParsedCli {
  let flags: GlobalOptions;
  let rest: string[];
  try {
    ({ flags, rest } = parseGlobalFlags(argv));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { kind: "error", message };
  }

  if (flags.help || rest.length === 0) {
    return { kind: "help" };
  }

  const [command, ...tail] = rest;

  if (command === "tasks") {
    return { kind: "tasks", options: flags };
  }

  if (command === "init") {
    try {
      return { kind: "init", options: parseInitFlags(flags, tail) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { kind: "error", message };
    }
  }

  if (command === "review") {
    if (tail.length > 0) {
      return { kind: "error", message: "review takes no positional arguments" };
    }
    return { kind: "review", options: flags };
  }

  if (command === "plan") {
    const sub = tail[0];
    const workItemId = tail[1];
    if (sub === "resume" || sub === "finish") {
      if (!workItemId) {
        return { kind: "error", message: "plan requires a work item id" };
      }
      return { kind: "plan", command: sub, workItemId, options: flags };
    }
    if (sub && DEV_WORK_ITEM_ID_PATTERN.test(sub)) {
      return {
        kind: "workflow",
        subcommand: "plan",
        workItemId: sub,
        rawArgs: tail.slice(1).join(" "),
        options: flags,
      };
    }
    return {
      kind: "error",
      message: "plan requires: resume|finish <work-item-id> OR plan <work-item-id>",
    };
  }

  if ((WORKFLOW_SUBCOMMANDS as readonly string[]).includes(command)) {
    const workItemId = tail[0];
    if (!workItemId) {
      return { kind: "error", message: `${command} requires a work item id` };
    }
    return {
      kind: "workflow",
      subcommand: command as WorkflowSubcommand,
      workItemId,
      rawArgs: tail.slice(1).join(" "),
      options: flags,
    };
  }

  if (command === "resume" || command === "finish") {
    const workItemId = tail[0];
    if (!workItemId) {
      return { kind: "error", message: `${command} requires a work item id` };
    }
    return { kind: command, workItemId, options: flags };
  }

  return { kind: "error", message: `Unknown command "${command}". Run accord --help.` };
}
