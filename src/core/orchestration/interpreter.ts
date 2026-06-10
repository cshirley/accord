/**
 * Graph interpreter — pure transition selection; resume alias for legacy imports.
 */

import { orchestrationGuardRegistry } from "./guards.js";
import type {
  NextStep,
  OrchestrationContext,
  OrchestrationGraphDefinition,
  OrchestrationGraphEdge,
  OrchestrationGraphEvent,
} from "./types.js";

export { resolveResumeOrchestration as interpretResume } from "./resolve/resume.js";

export function selectOrchestrationEdge(
  graph: OrchestrationGraphDefinition,
  fromNodeId: string,
  event: OrchestrationGraphEvent,
): OrchestrationGraphEdge | null {
  for (const edge of graph.edges) {
    if (edge.from !== fromNodeId || edge.event !== event.type) {
      continue;
    }
    if (edge.guard) {
      const guardFn = orchestrationGuardRegistry[edge.guard];
      if (!guardFn) {
        return null;
      }
      const ctx: OrchestrationContext = { currentNodeId: fromNodeId };
      if (!guardFn(ctx)) {
        continue;
      }
    }
    return edge;
  }
  return null;
}

export function transitionOrchestrationGraph(
  graph: OrchestrationGraphDefinition,
  currentNodeId: string,
  event: OrchestrationGraphEvent,
): string | null {
  const edge = selectOrchestrationEdge(graph, currentNodeId, event);
  return edge?.to ?? null;
}

export function spawnTaskStubForGraphAgent(agentId: string, workItemId: string): string {
  return [
    "ACCORD orchestration graph step (test / smoke).",
    "",
    `work_item_id: ${workItemId}`,
    `dispatch_agent: ${agentId}`,
  ].join("\n");
}

export function nextSpawnStepForNode(
  graph: OrchestrationGraphDefinition,
  nodeId: string,
  workItemId: string,
): NextStep | null {
  const node = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!node?.agentId) {
    return null;
  }
  return {
    kind: "spawn_subagent",
    workItemId,
    request: {
      agent: node.agentId,
      task: spawnTaskStubForGraphAgent(node.agentId, workItemId),
    },
  };
}
