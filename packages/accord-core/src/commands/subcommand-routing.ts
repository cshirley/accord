/**
 * Single source of truth for who owns each `/dev` / `/accord` subcommand.
 */

import { DEV_SUBCOMMANDS } from "./dispatch.js";

/** Where execution is handled for a known subcommand token. */
export type DevSubcommandOwner =
  /** Handled in `extension.ts` without programmatic subagent spawns. */
  | "extension_local"
  /** Core orchestrator (`runDevSubcommandOrchestrationWithReplans` / resume / finish). */
  | "core_orchestrator";

const ROUTING: Readonly<Record<string, DevSubcommandOwner>> = {
  help: "extension_local",
  tasks: "extension_local",
  retro: "extension_local",
  tag: "extension_local",
  rehydrate: "extension_local",
  init: "extension_local",
  "spec-gaps": "extension_local",
  review: "extension_local",
  gaps: "extension_local",
  deviations: "extension_local",
  resume: "core_orchestrator",
  finish: "core_orchestrator",
  align: "core_orchestrator",
  spec: "core_orchestrator",
  plan: "core_orchestrator",
  check: "core_orchestrator",
  "amend-spec": "core_orchestrator",
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
