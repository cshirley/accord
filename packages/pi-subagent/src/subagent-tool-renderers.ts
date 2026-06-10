/**
 * Optional subagent tool TUI renderers (set when the Pi extension registers the tool).
 * ACCORD orchestration UI may reuse them for in-chat spawn rows.
 */

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";

export type SubagentToolRenderers = {
  renderCall?: ToolDefinition["renderCall"];
  renderResult?: ToolDefinition["renderResult"];
};

let renderers: SubagentToolRenderers | undefined;

export function setSubagentToolRenderers(next: SubagentToolRenderers): void {
  renderers = next;
}

export function getSubagentToolRenderers(): SubagentToolRenderers | undefined {
  return renderers;
}
