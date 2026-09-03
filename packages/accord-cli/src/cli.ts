/**
 * Minimal argv parser for `accord` CLI (no extra deps).
 */

import path from "node:path";
import { DEV_WORK_ITEM_ID_PATTERN } from "@clive.shirley/accord-core/commands/dispatch.js";
import type { WriteTarget } from "@clive.shirley/accord-core/config/init-write.js";
import type { PlanCommand } from "./commands/plan.js";
import { WORKFLOW_SUBCOMMANDS, type WorkflowSubcommand } from "./commands/workflow.js";
import { renderHelp } from "./ui/help-display.js";

export type GlobalOptions = {
  cwd: string;
  harness: string | undefined;
  json: boolean;
  yes: boolean;
  help: boolean;
  finish: boolean;
  maxRounds: number | undefined;
  select: boolean;
  noColor: boolean;
};

export type InitOptions = GlobalOptions & {
  write: boolean;
  target: WriteTarget | undefined;
};

export type ConfigInitOptions = GlobalOptions & {
  write: boolean;
  force: boolean;
  defaultHarness?: string;
};

export type ParsedCli =
  | { kind: "help" }
  | { kind: "interactive"; options: GlobalOptions }
  | { kind: "completion"; shell: string; options: GlobalOptions }
  | { kind: "dev-help"; options: GlobalOptions }
  | { kind: "tasks"; options: GlobalOptions }
  | { kind: "retro"; options: GlobalOptions }
  | { kind: "tag"; rawArgs: string; options: GlobalOptions }
  | { kind: "rehydrate"; workItemId: string; options: GlobalOptions }
  | { kind: "spec-gaps"; workItemId: string; options: GlobalOptions }
  | {
      kind: "gaps";
      workItemId: string;
      rawArgs: string;
      options: GlobalOptions;
    }
  | {
      kind: "deviations";
      workItemId: string;
      rawArgs: string;
      options: GlobalOptions;
    }
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
  | { kind: "drive"; workItemId: string; options: GlobalOptions }
  | { kind: "run"; text: string; options: GlobalOptions }
  | { kind: "init"; options: InitOptions }
  | { kind: "config-init"; options: ConfigInitOptions }
  | { kind: "review"; options: GlobalOptions }
  | { kind: "error"; message: string };

export function printHelp(): void {
  console.log(renderHelp());
}

const INIT_TARGETS = new Set<WriteTarget>(["local", "root", "root_replace", "link_only"]);

function parseGlobalFlags(argv: string[]): { flags: GlobalOptions; rest: string[] } {
  const flags: GlobalOptions = {
    cwd: process.cwd(),
    harness: undefined,
    json: false,
    yes: false,
    help: false,
    finish: false,
    maxRounds: undefined,
    select: false,
    noColor: false,
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
    } else if (token === "--finish") {
      flags.finish = true;
    } else if (token === "--max-rounds") {
      const next = argv[++index];
      const parsed = Number.parseInt(next ?? "", 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error("--max-rounds requires a positive integer");
      }
      flags.maxRounds = parsed;
    } else if (token.startsWith("--max-rounds=")) {
      const parsed = Number.parseInt(token.slice("--max-rounds=".length), 10);
      if (!Number.isFinite(parsed) || parsed < 1) {
        throw new Error("--max-rounds requires a positive integer");
      }
      flags.maxRounds = parsed;
    } else if (token.startsWith("--harness=")) {
      flags.harness = token.slice("--harness=".length);
    } else if (token === "--select") {
      flags.select = true;
    } else if (token === "--no-color") {
      flags.noColor = true;
    } else {
      rest.push(token);
    }
  }

  return { flags, rest };
}

function parseConfigInitFlags(flags: GlobalOptions, tail: string[]): ConfigInitOptions {
  const configInit: ConfigInitOptions = {
    ...flags,
    write: false,
    force: false,
    defaultHarness: undefined,
  };

  for (let index = 0; index < tail.length; index++) {
    const token = tail[index];
    if (token === "--write") {
      configInit.write = true;
    } else if (token === "--force") {
      configInit.force = true;
    } else if (token === "--harness") {
      const next = tail[++index];
      if (!next) throw new Error("--harness requires a backend id");
      configInit.defaultHarness = next;
    } else if (token.startsWith("--harness=")) {
      configInit.defaultHarness = token.slice("--harness=".length);
    } else {
      throw new Error(`Unknown config init flag: ${token}`);
    }
  }

  return configInit;
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

  if (flags.help) {
    return { kind: "help" };
  }

  if (rest.length === 0) {
    if (process.stdin.isTTY) {
      return { kind: "interactive", options: flags };
    }
    return { kind: "help" };
  }

  const [command, ...tail] = rest;

  if (command === "help") {
    return { kind: "dev-help", options: flags };
  }

  if (command === "completion") {
    const shell = tail[0];
    if (!shell) {
      return { kind: "error", message: "completion requires a shell: bash or zsh" };
    }
    return { kind: "completion", shell, options: flags };
  }

  if (command === "tasks") {
    return { kind: "tasks", options: flags };
  }

  if (command === "retro") {
    return { kind: "retro", options: flags };
  }

  if (command === "tag") {
    return { kind: "tag", rawArgs: tail.join(" "), options: flags };
  }

  if (command === "rehydrate") {
    const workItemId = tail[0];
    if (!workItemId) {
      return { kind: "error", message: "rehydrate requires a work item id" };
    }
    return { kind: "rehydrate", workItemId, options: flags };
  }

  if (command === "spec-gaps") {
    const workItemId = tail[0];
    if (!workItemId) {
      return { kind: "error", message: "spec-gaps requires a work item id" };
    }
    return { kind: "spec-gaps", workItemId, options: flags };
  }

  if (command === "gaps") {
    const workItemId = tail[0];
    if (!workItemId) {
      return { kind: "error", message: "gaps requires a work item id" };
    }
    return {
      kind: "gaps",
      workItemId,
      rawArgs: tail.slice(1).join(" "),
      options: flags,
    };
  }

  if (command === "deviations") {
    const workItemId = tail[0];
    if (!workItemId) {
      return {
        kind: "error",
        message: "deviations requires a work item id (accept|revert|review optional)",
      };
    }
    return {
      kind: "deviations",
      workItemId,
      rawArgs: tail.slice(1).join(" "),
      options: flags,
    };
  }

  if (command === "config" && tail[0] === "init") {
    try {
      return { kind: "config-init", options: parseConfigInitFlags(flags, tail.slice(1)) };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { kind: "error", message };
    }
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

  if (command === "drive") {
    const workItemId = tail[0];
    if (!workItemId) {
      return { kind: "error", message: "drive requires a work item id" };
    }
    return { kind: "drive", workItemId, options: flags };
  }

  if (command === "run") {
    const text = tail.join(" ").trim();
    if (!text) {
      return { kind: "error", message: "run requires a ticket id or description" };
    }
    return { kind: "run", text, options: flags };
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
