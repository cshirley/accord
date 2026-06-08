/**
 * Harness orchestration types — resume outcomes, graph events, runner steps.
 */

import type { OrchestrationNotifyLevel } from "./host.js";

export interface OrchestrationMessage {
  level: OrchestrationNotifyLevel;
  text: string;
}

export type ResumeOrchestrationResolution =
  | { outcome: "complete"; messages: OrchestrationMessage[] }
  | { outcome: "blocked"; messages: OrchestrationMessage[] }
  | {
      outcome: "spawn";
      workItemId: string;
      agent: string;
      task: string;
      /** Reconcile / preflight notices surfaced before spawn (optional). */
      messages?: OrchestrationMessage[];
    };

/** Reason the outer loop stopped (extended over time). */
export type OrchestrationStopReason = "complete" | "blocked" | "spawned_subagent" | "idle";

/** Single subagent invocation (aligns with `subagent` tool / harness spawn). */
export interface SubagentSpawnRequest {
  agent: string;
  task: string;
}

/**
 * S0c — parallel / chain payloads relative to `collectSubagentEntries`:
 * chain runs sequentially; parallel runs concurrently (host-dependent).
 */
export interface SubagentChainSpawnRequest {
  mode: "chain";
  steps: SubagentSpawnRequest[];
}

export interface SubagentParallelSpawnRequest {
  mode: "parallel";
  tasks: SubagentSpawnRequest[];
}

export type SubagentMultiSpawnRequest = SubagentChainSpawnRequest | SubagentParallelSpawnRequest;

export type NextStep =
  | { kind: "spawn_subagent"; workItemId: string; request: SubagentSpawnRequest }
  | { kind: "spawn_chain"; workItemId: string; request: SubagentChainSpawnRequest }
  | { kind: "spawn_parallel"; workItemId: string; request: SubagentParallelSpawnRequest }
  | { kind: "notify_user"; message: OrchestrationMessage }
  | { kind: "stop"; reason: OrchestrationStopReason };

/** Minimal spawn result for runner / tests (Pi adapter fills from `runSubagent`). */
export interface SubagentSpawnResult {
  exitCode: number;
  /** Parsed JSON return packet when the subagent emitted one. */
  parsedReturn?: unknown;
}

export interface LastSpawnSummary {
  agent: string;
  exitCode: number;
  parsedReturn?: unknown;
}

/** Result of {@link runUntilStop} — includes last subagent spawn for sequential replan loops. */
export interface RunUntilStopResult {
  stopReason: OrchestrationStopReason;
  delegateReason?: string;
  /** Set when the terminal step was a successful or failed subagent invocation (single, chain tail, or parallel). */
  lastSpawn?: LastSpawnSummary;
}

export interface OrchestrationGraphNode {
  id: string;
  /** When the interpreter lands on this node after a transition, it may emit a spawn step. */
  agentId?: string;
}

export interface OrchestrationGraphEdge {
  from: string;
  to: string;
  /** Event name — e.g. synthetic harness events or `SubagentCompleted` classifiers. */
  event: string;
  /** When set, {@link orchestrationGuardRegistry} must supply this predicate. */
  guard?: string;
}

export interface OrchestrationGraphDefinition {
  entryNodeId: string;
  nodes: readonly OrchestrationGraphNode[];
  edges: readonly OrchestrationGraphEdge[];
}

/** Context for graph interpreter tests and future FSM ticks. */
export interface OrchestrationContext {
  currentNodeId: string;
  /** Optional payload for building spawn tasks from templates. */
  workItemId?: string;
}

export interface OrchestrationGraphEvent {
  type: string;
}
