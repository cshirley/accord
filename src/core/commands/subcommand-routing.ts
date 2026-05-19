/**
 * Single source of truth for who owns each `/dev` / `/accord` subcommand.
 *
 * Phase 4: extension and docs stay aligned; core orchestration grows behind flags.
 */

import { DEV_SUBCOMMANDS } from "./dispatch.js";

/** Where execution is handled for a known subcommand token. */
export type DevSubcommandOwner =
  /** Handled in `extension.ts` without invoking the accord skill. */
  | "extension_local"
  /** `resume` / `finish` via core orchestrator by default (adapter tries core first). */
  | "core_orchestrator_when_flagged"
  /** Forwarded as `/skill:accord …` for LLM-driven workflow. */
  | "skill";

const ROUTING: Readonly<Record<string, DevSubcommandOwner>> = {
  help: "extension_local",
  tasks: "extension_local",
  retro: "extension_local",
  tag: "extension_local",
  resume: "core_orchestrator_when_flagged",
  rehydrate: "extension_local",
  finish: "core_orchestrator_when_flagged",
  init: "skill",
  align: "skill",
  spec: "skill",
  plan: "skill",
  check: "skill",
  gaps: "skill",
  review: "skill",
  deviations: "skill",
  "amend-spec": "skill",
  "spec-gaps": "skill",
} as const;

export function assertSubcommandRoutingComplete(): void {
  for (const entry of DEV_SUBCOMMANDS) {
    if (!(entry.value in ROUTING)) {
      throw new Error(
        `subcommand-routing: missing owner for DEV_SUBCOMMANDS entry "${entry.value}"`,
      );
    }
  }
}

export function getDevSubcommandOwner(subcommand: string): DevSubcommandOwner {
  const owner = ROUTING[subcommand];
  if (!owner) {
    throw new Error(`subcommand-routing: unknown subcommand "${subcommand}"`);
  }
  return owner;
}

/** Subcommands allowed under Pi plan mode (read-only / no side effects on work state). */
export function isPlanModeReadOnlyDevSubcommand(subcommand: string): boolean {
  return subcommand === "help" || subcommand === "tasks" || subcommand === "retro";
}

void assertSubcommandRoutingComplete();
