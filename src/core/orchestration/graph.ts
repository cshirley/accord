/**
 * Declarative orchestration graph + startup validation (Phase 1).
 */

import { getAgentMeta, registeredAgentNames } from "../agents/registry.js";
import { orchestrationGuardRegistry } from "./guards.js";
import { COARSE_RESUME_AGENT_IDS } from "./phase-coarse-routing.js";
import type { OrchestrationGraphDefinition } from "./types.js";

/**
 * Minimal reference graph for CI validation and unit tests.
 * Not wired to live `/dev` routes yet — demonstrates edges, guards, reachability.
 */
export const REFERENCE_ORCHESTRATION_GRAPH: OrchestrationGraphDefinition = {
  entryNodeId: "idle",
  nodes: [
    { id: "idle" },
    { id: "awaiting_gather", agentId: "phase-gather" },
    { id: "awaiting_plan", agentId: "phase-plan" },
  ],
  edges: [
    { from: "idle", to: "awaiting_gather", event: "tap_gather" },
    {
      from: "awaiting_gather",
      to: "awaiting_plan",
      event: "subagent_done",
      guard: "always_true",
    },
  ],
};

function validateResumeRoutingAgents(errors: string[]): void {
  for (const agentId of COARSE_RESUME_AGENT_IDS) {
    if (!getAgentMeta(agentId)) {
      errors.push(`resume coarse routing: agent ${agentId} is not in the registry`);
    }
  }
}

/**
 * Validates the orchestration graph: registry non-empty, node ids unique,
 * agentIds registered, edges reference existing nodes, guards exist,
 * all nodes reachable from {@link OrchestrationGraphDefinition.entryNodeId}.
 */
export function validateOrchestrationGraph(
  graph: OrchestrationGraphDefinition = REFERENCE_ORCHESTRATION_GRAPH,
): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const names = registeredAgentNames();
  if (names.length === 0) {
    errors.push("agent registry is empty");
  }

  const seenIds = new Set<string>();
  const nodeIds = new Set<string>();
  for (const node of graph.nodes) {
    if (!node.id) {
      errors.push("orchestration graph: node missing id");
      continue;
    }
    if (seenIds.has(node.id)) {
      errors.push(`orchestration graph: duplicate node id ${node.id}`);
    }
    seenIds.add(node.id);
    nodeIds.add(node.id);
    if (node.agentId && !getAgentMeta(node.agentId)) {
      errors.push(
        `orchestration graph: node ${node.id} references unknown agentId ${node.agentId}`,
      );
    }
  }

  if (!nodeIds.has(graph.entryNodeId)) {
    errors.push(`orchestration graph: entryNodeId "${graph.entryNodeId}" is not a defined node`);
  }

  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.from)) {
      errors.push(`orchestration graph: edge references unknown from="${edge.from}"`);
    }
    if (!nodeIds.has(edge.to)) {
      errors.push(`orchestration graph: edge references unknown to="${edge.to}"`);
    }
    if (
      edge.guard !== undefined &&
      edge.guard !== "" &&
      !(edge.guard in orchestrationGuardRegistry)
    ) {
      errors.push(
        `orchestration graph: unknown guard "${edge.guard}" on edge ${edge.from}→${edge.to}`,
      );
    }
  }

  const reachable = new Set<string>();
  const queue: string[] = [graph.entryNodeId];
  while (queue.length > 0) {
    const id = queue.pop();
    if (id === undefined) break;
    if (reachable.has(id)) continue;
    reachable.add(id);
    for (const edge of graph.edges) {
      if (edge.from === id) {
        queue.push(edge.to);
      }
    }
  }

  for (const node of graph.nodes) {
    if (!reachable.has(node.id)) {
      errors.push(
        `orchestration graph: unreachable node "${node.id}" from entry "${graph.entryNodeId}"`,
      );
    }
  }

  validateResumeRoutingAgents(errors);

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
