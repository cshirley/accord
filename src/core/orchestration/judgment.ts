/**
 * Phase 5 — bounded LLM judgment for brief supplements.
 *
 * Host returns raw model text; core extracts JSON, validates shape, then merges.
 * Invalid or hostile payloads fall back to a deterministic template appendix.
 */

import type { DevHarnessConfig } from "../config/types.js";
import { findBalancedJsonRegions } from "../subagent/result/packet.js";

export const ORCHESTRATION_JUDGMENT_SCHEMA_VERSION = "1.0" as const;

/** Forbidden keys — judgment must never route or name harness agents. */
const FORBIDDEN_JUDGMENT_KEYS = new Set([
  "agent",
  "agents",
  "subagent",
  "spawn",
  "next_step",
  "next_agent",
  "tool",
  "tools",
  "dispatch_agent",
]);

export interface OrchestrationJudgmentPacket {
  schema_version: typeof ORCHESTRATION_JUDGMENT_SCHEMA_VERSION;
  brief_appendix: string;
  focus_points?: string[];
}

const DEFAULT_JUDGMENT_AGENTS = ["review-test", "phase-test"] as const;

export function defaultJudgmentDispatchAgents(): readonly string[] {
  return DEFAULT_JUDGMENT_AGENTS;
}

/** True when AGENTS config allows judgment for this dispatch agent (no env gate — host may still skip LLM). */
export function isOrchestrationJudgmentConfigured(
  devConfig: DevHarnessConfig | null,
  dispatchAgent: string,
): boolean {
  const judgment = devConfig?.orchestration?.judgment;
  if (!judgment?.enabled) return false;
  const allow = judgment.agents?.length ? judgment.agents : [...DEFAULT_JUDGMENT_AGENTS];
  return allow.includes(dispatchAgent);
}

export function buildTemplateOnlyJudgmentAppendix(
  workItemId: string,
  dispatchAgent: string,
): string {
  return [
    "",
    "## Judgment supplement (harness — template)",
    "",
    `No validated LLM judgment was merged for work item \`${workItemId}\` / dispatch \`${dispatchAgent}\`.`,
    "Proceed using the task body above; align changes with persisted spec/plan/task state.",
  ].join("\n");
}

function mergeValidatedAppendix(baseTask: string, packet: OrchestrationJudgmentPacket): string {
  const focus =
    packet.focus_points
      ?.filter((line) => line.trim().length > 0)
      .map((line) => `- ${line.trim()}`) ?? [];
  const focusBlock = focus.length ? ["", "### Focus", ...focus, ""].join("\n") : "";
  return `${baseTask}\n\n## Judgment supplement (harness)\n\n${packet.brief_appendix.trim()}${focusBlock}`;
}

/**
 * Pull a JSON object from model output (handles optional ```json fences).
 * Iterates balanced `{...}` regions from the end so multi-object output (tool
 * echoes + judgment block) returns the last parseable region rather than
 * collapsing the whole span into an unparseable greedy slice.
 */
export function extractJsonObjectFromModelText(text: string): unknown | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fence = /^```(?:json)?\s*([\s\S]*?)```/m.exec(trimmed);
  const candidate = fence ? fence[1].trim() : trimmed;
  const regions = findBalancedJsonRegions(candidate);
  for (let i = regions.length - 1; i >= 0; i--) {
    const region = regions[i];
    if (region === undefined) continue;
    try {
      return JSON.parse(region) as unknown;
    } catch {
      /* try the next region */
    }
  }
  return null;
}

export function validateOrchestrationJudgmentPacket(
  data: unknown,
): { ok: true; value: OrchestrationJudgmentPacket } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!data || typeof data !== "object") {
    errors.push("judgment: expected object");
    return { ok: false, errors };
  }
  const record = data as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_JUDGMENT_KEYS.has(key.toLowerCase())) {
      errors.push(`judgment: forbidden key "${key}"`);
    }
  }
  if (record.schema_version !== ORCHESTRATION_JUDGMENT_SCHEMA_VERSION) {
    errors.push(`judgment: schema_version must be "${ORCHESTRATION_JUDGMENT_SCHEMA_VERSION}"`);
  }
  if (typeof record.brief_appendix !== "string") {
    errors.push("judgment: brief_appendix must be a string");
  } else if (record.brief_appendix.length > 8000) {
    errors.push("judgment: brief_appendix exceeds 8000 characters");
  }
  if (record.focus_points !== undefined) {
    if (!Array.isArray(record.focus_points)) {
      errors.push("judgment: focus_points must be an array when present");
    } else {
      if (record.focus_points.length > 24) {
        errors.push("judgment: focus_points max length is 24");
      }
      for (const [index, item] of record.focus_points.entries()) {
        if (typeof item !== "string") {
          errors.push(`judgment: focus_points[${String(index)}] must be a string`);
        } else if (item.length > 500) {
          errors.push(`judgment: focus_points[${String(index)}] exceeds 500 characters`);
        }
      }
    }
  }
  const allowed = new Set(["schema_version", "brief_appendix", "focus_points"]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      errors.push(`judgment: unexpected key "${key}"`);
    }
  }
  if (errors.length) return { ok: false, errors };

  const value: OrchestrationJudgmentPacket = {
    schema_version: ORCHESTRATION_JUDGMENT_SCHEMA_VERSION,
    brief_appendix: (record.brief_appendix as string).trim(),
    focus_points: Array.isArray(record.focus_points)
      ? (record.focus_points as string[]).map((s) => s.trim()).filter(Boolean)
      : undefined,
  };
  return { ok: true, value };
}

/**
 * When judgment is configured for this resume spawn, merge model output or template fallback.
 */
export function mergeResumeTaskWithJudgment(input: {
  baseTask: string;
  /** Raw assistant text (may contain JSON). Undefined when the host skipped the LLM call. */
  rawLlmText: string | undefined;
  workItemId: string;
  dispatchAgent: string;
}): string {
  const parsed =
    input.rawLlmText === undefined ? null : extractJsonObjectFromModelText(input.rawLlmText);
  if (parsed !== null) {
    const validated = validateOrchestrationJudgmentPacket(parsed);
    if (validated.ok) {
      return mergeValidatedAppendix(input.baseTask, validated.value);
    }
  }
  return `${input.baseTask}${buildTemplateOnlyJudgmentAppendix(input.workItemId, input.dispatchAgent)}`;
}
