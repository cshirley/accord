/**
 * Pi adapter — dynamic activation of `dev_*` tools to shrink the system-prompt surface.
 */

import {
  type AccordToolBundle,
  allRegisteredDevToolNames,
  buildAccordActiveToolNames,
  bundleForDevTool,
  bundlesForAgentId,
  bundlesForDevSubcommand,
  bundlesForWorkItemPhase,
  isDynamicToolsEnabled,
} from "@clive.shirley/accord-core/tools/active-set.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { HookState } from "./hook-state.js";

export function resetDynamicToolBundles(state: HookState): void {
  state.activatedToolBundles = new Set();
}

export function activateToolBundles(state: HookState, bundles: AccordToolBundle[]): void {
  for (const bundle of bundles) {
    state.activatedToolBundles.add(bundle);
  }
}

export function applyAccordActiveTools(pi: ExtensionAPI, state: HookState): void {
  if (!isDynamicToolsEnabled()) return;
  const active = buildAccordActiveToolNames(state.activatedToolBundles, pi.getActiveTools());
  pi.setActiveTools(active);
}

export function activateForDevSubcommand(
  pi: ExtensionAPI,
  state: HookState,
  subcommand: string,
): void {
  if (!isDynamicToolsEnabled()) return;
  activateToolBundles(state, bundlesForDevSubcommand(subcommand));
  applyAccordActiveTools(pi, state);
}

export function activateForDispatchAgent(
  pi: ExtensionAPI,
  state: HookState,
  agentId: string,
): void {
  if (!isDynamicToolsEnabled()) return;
  activateToolBundles(state, bundlesForAgentId(agentId));
  applyAccordActiveTools(pi, state);
}

export function activateForWorkItemPhase(pi: ExtensionAPI, state: HookState, phase: string): void {
  if (!isDynamicToolsEnabled()) return;
  activateToolBundles(state, bundlesForWorkItemPhase(phase));
  applyAccordActiveTools(pi, state);
}

/** Auto-activate a bundle when the model calls an inactive `dev_*` tool. */
export function maybeActivateDevToolCall(
  pi: ExtensionAPI,
  state: HookState,
  toolName: string,
): boolean {
  if (!isDynamicToolsEnabled() || !toolName.startsWith("dev_")) return false;
  const bundle = bundleForDevTool(toolName);
  if (!bundle || state.activatedToolBundles.has(bundle)) return false;
  activateToolBundles(state, [bundle]);
  applyAccordActiveTools(pi, state);
  return true;
}

export function inactiveRegisteredDevTools(pi: ExtensionAPI): string[] {
  if (!isDynamicToolsEnabled()) return [];
  const active = new Set(pi.getActiveTools());
  return allRegisteredDevToolNames().filter((name) => !active.has(name));
}
