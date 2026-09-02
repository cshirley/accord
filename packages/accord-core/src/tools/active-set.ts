/**
 * Dynamic `dev_*` tool activation sets for the Pi adapter (Phase 2).
 *
 * All tools remain registered; {@link buildAccordActiveToolNames} selects which
 * names are active in the system prompt. MCP / stdio keeps every tool active.
 */

import { ACCORD_TOOLS } from "./registry.js";

/** Always-active harness tools (Pi sessions). */
export const ACCORD_CORE_TOOLS: readonly string[] = [
  "dev_intent",
  "dev_intent_enrich",
  "dev_bootstrap",
  "dev_resume_state",
  "dev_work_item_status",
  "dev_tasks",
  "subagent",
];

export type AccordToolBundle = "spec" | "plan" | "code" | "init" | "meta";

/** Phase-oriented tool bundles activated on demand. */
export const ACCORD_TOOL_BUNDLES: Record<AccordToolBundle, readonly string[]> = {
  spec: [
    "dev_checkpoint",
    "dev_spec_gaps",
    "dev_transition",
    "dev_finalize",
    "dev_subagent_preflight",
  ],
  plan: ["dev_checkpoint", "dev_transition", "dev_subagent_preflight"],
  code: [
    "dev_code_brief",
    "dev_nonce",
    "dev_quick_fix_brief",
    "dev_verify_summary",
    "dev_promote_events",
    "dev_decision_packet",
    "dev_subagent_preflight",
  ],
  init: ["dev_init_detect", "dev_init_write"],
  meta: ["dev_retro", "dev_review_queue", "dev_workflow_cost", "dev_orchestrate", "dev_rehydrate"],
};

const ALL_BUNDLE_TOOL_NAMES = new Set<string>(Object.values(ACCORD_TOOL_BUNDLES).flat());

const DEV_TOOL_TO_BUNDLE: Map<string, AccordToolBundle> = new Map();
for (const [bundle, tools] of Object.entries(ACCORD_TOOL_BUNDLES) as [
  AccordToolBundle,
  readonly string[],
][]) {
  for (const tool of tools) {
    if (!DEV_TOOL_TO_BUNDLE.has(tool)) {
      DEV_TOOL_TO_BUNDLE.set(tool, bundle);
    }
  }
}

const AGENT_ID_TO_BUNDLES: Record<string, AccordToolBundle[]> = {
  "phase-align": ["spec"],
  "phase-spec": ["spec"],
  "phase-explore": ["spec"],
  "phase-gather": ["spec"],
  "phase-hypothesise": ["spec"],
  "review-spec": ["spec"],
  "phase-plan": ["plan"],
  "review-plan": ["plan"],
  "phase-code": ["code"],
  "phase-test": ["code"],
  "phase-verify-task": ["code"],
  "phase-verify-acceptance": ["code"],
  "phase-verify-infra": ["code"],
  "phase-gaps": ["code"],
  "review-code": ["code"],
  "review-test": ["code"],
  "review-deviation": ["code"],
  "review-security": ["code"],
  "review-design": ["code"],
  "review-investigation": ["code"],
};

const SUBCOMMAND_TO_BUNDLES: Record<string, AccordToolBundle[]> = {
  align: ["spec"],
  spec: ["spec"],
  "amend-spec": ["spec"],
  plan: ["plan"],
  check: ["code"],
  gaps: ["code"],
  deviations: ["code"],
  finish: ["meta", "code"],
  init: ["init"],
  rehydrate: ["meta"],
  retro: ["meta"],
};

const COARSE_PHASE_TO_BUNDLES: Record<string, AccordToolBundle[]> = {
  aligning: ["spec"],
  speccing: ["spec"],
  exploring: ["spec"],
  gathering: ["spec"],
  researching: ["spec"],
  planning: ["plan"],
  implementing: ["code"],
  fixing: ["code"],
};

/** Default on after Phase 2 bake-in; set `ACCORD_DYNAMIC_TOOLS=0` to disable. */
export function isDynamicToolsEnabled(): boolean {
  const raw = process.env.ACCORD_DYNAMIC_TOOLS?.trim();
  if (!raw) return true;
  const lower = raw.toLowerCase();
  if (raw === "0" || lower === "false" || lower === "no" || lower === "off") {
    return false;
  }
  return true;
}

export function isManagedAccordTool(toolName: string): boolean {
  return toolName.startsWith("dev_") || toolName === "subagent";
}

export function allRegisteredDevToolNames(): string[] {
  return ACCORD_TOOLS.map((tool) => tool.name);
}

export function bundleForDevTool(toolName: string): AccordToolBundle | null {
  return DEV_TOOL_TO_BUNDLE.get(toolName) ?? null;
}

export function bundlesForAgentId(agentId: string): AccordToolBundle[] {
  return AGENT_ID_TO_BUNDLES[agentId] ?? [];
}

export function bundlesForDevSubcommand(subcommand: string): AccordToolBundle[] {
  return SUBCOMMAND_TO_BUNDLES[subcommand] ?? [];
}

export function bundlesForWorkItemPhase(phase: string): AccordToolBundle[] {
  if (AGENT_ID_TO_BUNDLES[phase]) {
    return AGENT_ID_TO_BUNDLES[phase];
  }
  return COARSE_PHASE_TO_BUNDLES[phase] ?? [];
}

export function toolsForBundles(bundles: ReadonlySet<AccordToolBundle>): string[] {
  const names = new Set<string>(ACCORD_CORE_TOOLS);
  for (const bundle of bundles) {
    for (const tool of ACCORD_TOOL_BUNDLES[bundle]) {
      names.add(tool);
    }
  }
  return [...names];
}

export function buildAccordActiveToolNames(
  activatedBundles: ReadonlySet<AccordToolBundle>,
  preservedToolNames: readonly string[],
): string[] {
  const names = new Set<string>();
  for (const tool of preservedToolNames) {
    if (!isManagedAccordTool(tool)) {
      names.add(tool);
    }
  }
  for (const tool of toolsForBundles(activatedBundles)) {
    names.add(tool);
  }
  return [...names];
}

/** Dev tools that are not in core or any bundle (should not happen if registry aligns). */
export function unbundledDevToolNames(): string[] {
  return allRegisteredDevToolNames().filter(
    (name) => !ACCORD_CORE_TOOLS.includes(name) && !ALL_BUNDLE_TOOL_NAMES.has(name),
  );
}
