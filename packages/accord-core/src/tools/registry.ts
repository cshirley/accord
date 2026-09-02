/**
 * Canonical registry of ACCORD `dev_*` tools.
 *
 * Adding a tool:
 *   1. Add a `defineTool({...})` entry below.
 *   2. Both Pi and MCP adapters iterate this array — no further wiring needed.
 *
 * Removing a tool: delete the `defineTool({...})` entry.
 *
 * Renaming or reordering a tool: the registry order is the on-the-wire order
 * for both adapters; the array itself is the source of truth.
 */

import { Type } from "typebox";
import { devCodeBrief, devNonce, devQuickFixBrief } from "../briefing/code-brief.js";
import { devDecisionPacket } from "../briefing/decision-packet.js";
import type { IntentRecommendation } from "../commands/intent.js";
import {
  formatIntentRecommendation,
  formatRefinementResult,
  recommendIntentMode,
  refineWithTicketSignals,
} from "../commands/intent.js";
import { devInitDetect } from "../config/init-detect.js";
import { devInitWrite, type WriteTarget } from "../config/init-write.js";
import type { DevHarnessConfig } from "../config/types.js";
import { buildDevOrchestratePayload, enrichDevOrchestratePayload } from "../orchestration/plan.js";
import { devTasks } from "../queries/dashboard.js";
import { devResumeState } from "../queries/resume-state.js";
import { devRetro } from "../queries/retro.js";
import { devReviewQueue } from "../queries/review-queue.js";
import { devSpecGaps } from "../queries/spec-gaps.js";
import { runSubagentSpawnPreflightCheck } from "../queries/subagent-preflight-shared.js";
import { devVerifySummary } from "../queries/verify-summary.js";
import { devWorkItemStatus } from "../queries/work-item-status.js";
import { buildWorkflowCostReport } from "../queries/workflow-cost.js";
import {
  devCheckpointDelete,
  devCheckpointRead,
  devCheckpointWrite,
} from "../work-items/checkpoint.js";
import {
  devBootstrap,
  devFinalizeWorkItem,
  devPromoteEvents,
  devTransition,
  type FinalizeWorkItemInput,
} from "../work-items/lifecycle.js";
import { devRehydrateWorkItem } from "../work-items/rehydrate.js";
import type { Checkpoint } from "../work-items/types.js";
import {
  checkpointActionEnum,
  confidenceEnum,
  escalationCeilingEnum,
  initWriteTargetEnum,
  intentModeEnum,
  patternEnum,
  terminalOutcomeEnum,
  variantEnum,
} from "./enums.js";
import { defineTool, type ToolDefinition } from "./types.js";

function stringifyFieldValues(fields: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]),
  );
}

export const ACCORD_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "dev_intent",
    label: "Classify Intent",
    description: "Recommend an ACCORD intent mode from the user's ask/brief",
    promptSnippet:
      "Classify user intent before bootstrapping: narrow_change, pipeline, review, commit, explain, investigate; returns escalation ceiling and target paths.",
    promptGuidelines: [
      "Call dev_intent before dev_bootstrap on a new ask; do not guess pattern or variant from user text alone.",
    ],
    parameters: Type.Object({
      text: Type.String({ description: "User ask or concise work description" }),
      brief: Type.Optional(
        Type.String({ description: "Optional existing brief/context to classify with the ask" }),
      ),
    }),
    handler(params) {
      const result = recommendIntentMode(params.text, params.brief);
      return { ok: true, text: formatIntentRecommendation(result), details: result };
    },
  }),

  defineTool({
    name: "dev_intent_enrich",
    label: "Enrich Intent",
    description:
      "Refine an intent recommendation using ticket metadata (AC count, story points, subtasks, etc.)",
    promptSnippet:
      "After dev_intent returns medium/low confidence and a ticket ID is present, fetch the ticket then call this with the initial recommendation + ticket signals to upgrade/downgrade the pattern.",
    promptGuidelines: [
      "Call dev_intent_enrich only after dev_intent and only when ticket metadata can refine a medium/low-confidence recommendation.",
    ],
    parameters: Type.Object({
      recommendation: Type.Object(
        {
          intent_mode: intentModeEnum,
          confidence: confidenceEnum,
          reasons: Type.Array(Type.String()),
          needs_confirmation: Type.Boolean(),
          escalation_ceiling: escalationCeilingEnum,
          target_paths: Type.Array(Type.String()),
          out_of_scope: Type.Array(Type.String()),
          recommended_pattern: Type.Optional(patternEnum),
          recommended_variant: Type.Optional(variantEnum),
        },
        { description: "The recommendation returned by dev_intent" },
      ),
      ticket_signals: Type.Object(
        {
          issue_type: Type.Optional(Type.String({ description: "e.g. Bug, Story, Task, Epic" })),
          story_points: Type.Optional(Type.Number({ description: "Story point estimate" })),
          ac_count: Type.Optional(
            Type.Number({ description: "Number of acceptance criteria in the ticket" }),
          ),
          description_length: Type.Optional(
            Type.Number({ description: "Character count of the ticket description" }),
          ),
          subtask_count: Type.Optional(Type.Number({ description: "Number of subtasks" })),
          linked_issue_count: Type.Optional(
            Type.Number({ description: "Number of linked issues" }),
          ),
        },
        { description: "Signals extracted from the ticket" },
      ),
    }),
    handler(params) {
      const result = refineWithTicketSignals(
        params.recommendation as IntentRecommendation,
        params.ticket_signals,
      );
      return { ok: true, text: formatRefinementResult(result), details: result };
    },
  }),

  defineTool({
    name: "dev_tasks",
    label: "Work Items",
    description: "Dashboard of active work items in .tasks/",
    promptSnippet: "Show work item dashboard with task status, costs, and pending decisions",
    promptGuidelines: [
      "Call dev_tasks to list active work items instead of scanning .tasks/ with read or bash.",
    ],
    parameters: Type.Object({}),
    handler() {
      const result = devTasks();
      return { ok: true, text: result.formatted, details: result };
    },
  }),

  defineTool({
    name: "dev_bootstrap",
    label: "Bootstrap Work Item",
    description: "Create a new work item JSON in .tasks/",
    promptSnippet: "Bootstrap a new work item with correct schema, timestamps, and entry phase",
    promptGuidelines: [
      "Call dev_bootstrap once per new work item after dev_intent confirms pattern; do not hand-author .tasks/*.json.",
    ],
    parameters: Type.Object({
      id: Type.String({ description: "Work item ID (e.g. ACCORD-1234)" }),
      title: Type.String({ description: "Short title" }),
      pattern: patternEnum,
      variant: Type.Optional(variantEnum),
      intent_mode: Type.Optional(intentModeEnum),
      intent_confidence: Type.Optional(confidenceEnum),
      escalation_ceiling: Type.Optional(escalationCeilingEnum),
      target_paths: Type.Optional(Type.Array(Type.String())),
      out_of_scope: Type.Optional(Type.Array(Type.String())),
      expected_finish: Type.Optional(
        Type.String({ description: "Short description of the user-visible finish condition" }),
      ),
    }),
    handler(params) {
      const result = devBootstrap(
        params.id,
        params.title,
        params.pattern as import("../types/domain.js").WorkItemPattern,
        params.variant as import("../types/domain.js").WorkItemVariant | undefined,
        {
          intent_mode: params.intent_mode as import("../types/domain.js").IntentMode | undefined,
          intent_confidence: params.intent_confidence as
            | import("../types/domain.js").IntentConfidence
            | undefined,
          escalation_ceiling: params.escalation_ceiling as string | undefined,
          target_paths: params.target_paths,
          out_of_scope: params.out_of_scope,
          expected_finish: params.expected_finish,
        },
      );
      return {
        ok: true,
        text: `Created ${result.path} (phase: ${result.work_item.phase})`,
        details: result,
      };
    },
  }),

  defineTool({
    name: "dev_checkpoint",
    label: "Checkpoint",
    description: "Read, write, or delete a checkpoint file for multi-turn phases",
    promptSnippet: "Manage checkpoint state for spec/plan multi-turn phases",
    parameters: Type.Object({
      id: Type.String({ description: "Work item ID" }),
      action: checkpointActionEnum,
      data: Type.Optional(
        Type.Object(
          {},
          {
            additionalProperties: true,
            description:
              "Checkpoint data object (for write action). Free-form JSON object; schema_version is normalised by the harness.",
          },
        ),
      ),
    }),
    handler(params) {
      if (params.action === "read") {
        const cp = devCheckpointRead(params.id);
        if (!cp) return { ok: true, text: "No checkpoint found." };
        return { ok: true, text: JSON.stringify(cp, null, 2), details: cp };
      }
      if (params.action === "write") {
        if (!params.data || typeof params.data !== "object") {
          return { ok: false, text: "dev_checkpoint write requires a 'data' object" };
        }
        const result = devCheckpointWrite(params.id, params.data as unknown as Checkpoint);
        return { ok: true, text: `Checkpoint written: ${result.path}` };
      }
      const deleted = devCheckpointDelete(params.id);
      return { ok: true, text: deleted ? "Checkpoint deleted." : "No checkpoint to delete." };
    },
  }),

  defineTool({
    name: "dev_review_queue",
    label: "Review Queue",
    description: "Collect pending decisions and deviations across all work items",
    promptSnippet:
      "Gather the review queue — pending decisions sorted by asked_at, deviations sorted by at",
    parameters: Type.Object({}),
    handler() {
      const result = devReviewQueue();
      return { ok: true, text: result.formatted, details: result };
    },
  }),

  defineTool({
    name: "dev_retro",
    label: "Retrospective",
    description: "Analyse pi-insights sessions associated with ACCORD runs",
    promptSnippet:
      "Run a retrospective over tagged/legacy harness sessions; highlights outcomes, friction, and shift-left opportunities for spec/plan/harness design.",
    parameters: Type.Object({
      insights_dir: Type.Optional(
        Type.String({
          description:
            "Path to pi-insights directory (defaults to ./insights or ~/.config/pi/agent/insights)",
        }),
      ),
      include_legacy_heuristic: Type.Optional(
        Type.Boolean({
          description:
            "Also include pre-marker sessions that mention /dev, .tasks, or phase agents (default true)",
        }),
      ),
      limit: Type.Optional(
        Type.Number({ description: "Maximum representative sessions to return (default 50)" }),
      ),
      since: Type.Optional(
        Type.String({ description: "Only include sessions since this ISO date/time" }),
      ),
      work_item_id: Type.Optional(
        Type.String({ description: "Only include sessions associated with this work item ID" }),
      ),
    }),
    handler(params) {
      const result = devRetro({
        insights_dir: params.insights_dir,
        include_legacy_heuristic: params.include_legacy_heuristic,
        limit: params.limit,
        since: params.since,
        work_item_id: params.work_item_id,
      });
      if (!result.ok) return { ok: false, text: result.error };
      return { ok: true, text: result.value.formatted, details: result.value };
    },
  }),

  defineTool({
    name: "dev_promote_events",
    label: "Promote Events",
    description: "Promote events from a per-task file to the parent work item",
    promptSnippet:
      "Process task events: escalations → decisions[], deviations → deviations[], request_review → review agents",
    parameters: Type.Object({
      work_item_id: Type.String(),
      task_id: Type.String(),
    }),
    handler(params) {
      const result = devPromoteEvents(params.work_item_id, params.task_id);
      const parts: string[] = [];
      if (result.escalations_added > 0) {
        parts.push(`${result.escalations_added} escalation(s) → decisions[]`);
      }
      if (result.deviations_added > 0) {
        parts.push(`${result.deviations_added} deviation(s) added`);
      }
      if (result.review_requested) {
        parts.push(`Review requested: ${result.review_agents.join(", ")}`);
      }
      if (parts.length === 0) parts.push("No new events to promote.");
      return { ok: true, text: parts.join("\n"), details: result };
    },
  }),

  defineTool({
    name: "dev_spec_gaps",
    label: "Spec Gaps",
    description: "Run the 10-point spec-gaps checklist against a finalised spec",
    promptSnippet: "Deterministic spec-gaps check — inspects JSON fields, no LLM reasoning needed",
    parameters: Type.Object({ id: Type.String({ description: "Work item ID" }) }),
    handler(params) {
      const result = devSpecGaps(params.id);
      if (!result.ok) return { ok: false, text: result.error };
      return { ok: true, text: result.value.formatted, details: result.value };
    },
  }),

  defineTool({
    name: "dev_code_brief",
    label: "Code Brief",
    description: "Assemble a complete phase-code brief from spec, plan, and task data",
    promptSnippet:
      "Build the code task brief with all context — avoids loading raw JSON into orchestrator context",
    parameters: Type.Object({
      work_item_id: Type.String(),
      task_id: Type.String(),
    }),
    handler(params, ctx) {
      const result = devCodeBrief(params.work_item_id, params.task_id, ctx.getConfig());
      if (!result.ok) return { ok: false, text: result.error };
      return {
        ok: true,
        text: result.value.brief,
        details: {
          brief_length: result.value.brief.length,
          owner_nonce: result.value.owner_nonce,
          task_file_path: result.value.task_file_path,
        },
      };
    },
  }),

  defineTool({
    name: "dev_quick_fix_brief",
    label: "Quick Fix Brief",
    description:
      "Create quick_fix task state, write spec/plan stubs, and assemble a phase-test or phase-code brief",
    promptSnippet:
      "For quick_fix/fixing work items only: create .tasks/<ID>-task-1.json, write auto-generated spec/plan stubs to docs/dev/<ID>/, persist task_ids and spec/plan paths on the work item, and return a phase-test brief. RGR applies for all strategies (including quick_fix_direct): phase-test → review-test → phase-code. After review-test, call dev_code_brief for the phase-code brief.",
    parameters: Type.Object({
      work_item_id: Type.String(),
    }),
    handler(params, ctx) {
      const result = devQuickFixBrief(params.work_item_id, ctx.getConfig());
      if (!result.ok) return { ok: false, text: result.error };
      return {
        ok: true,
        text: result.value.brief,
        details: {
          brief_path: result.value.brief_path,
          task_file_path: result.value.task_file_path,
          task_id: result.value.task_id,
          brief_type: result.value.brief_type,
        },
      };
    },
  }),

  defineTool({
    name: "dev_rehydrate",
    label: "Rehydrate Work Item",
    description:
      "Recreate .tasks/<ID>.json (and task files from plan.json) from docs/dev/<ID>/ when runtime state was lost",
    promptSnippet:
      "When .tasks/ is missing but brief/spec/plan exist on disk, call before dev_resume_state. Idempotent if the work item already exists.",
    parameters: Type.Object({ id: Type.String({ description: "Work item ID" }) }),
    handler(params) {
      const result = devRehydrateWorkItem(params.id);
      if (!result.ok) return { ok: false, text: result.error };
      return { ok: true, text: result.value.message, details: result.value };
    },
  }),

  defineTool({
    name: "dev_resume_state",
    label: "Resume State",
    description: "Read work item + checkpoint state for /dev resume routing",
    promptSnippet:
      "Get resume state: phase, checkpoint presence, pattern — for dispatch routing. Rehydrates from docs/dev/ when .tasks/ is missing.",
    promptGuidelines: [
      "Call dev_resume_state before spawning phase agents when resuming an existing work item on disk.",
    ],
    parameters: Type.Object({ id: Type.String({ description: "Work item ID" }) }),
    handler(params) {
      const result = devResumeState(params.id);
      if (!result.ok) return { ok: false, text: result.error };
      return {
        ok: true,
        text: `${result.value.id}: phase=${result.value.phase}, checkpoint=${result.value.has_checkpoint}, pattern=${result.value.pattern}`,
        details: result.value,
      };
    },
  }),

  defineTool({
    name: "dev_work_item_status",
    label: "Work Item Status",
    description:
      "Single work-item dashboard: phase, tasks, next resume agent, finish nudge when all implementation tasks are terminal",
    promptSnippet:
      "Prefer over ad-hoc read/bash when the user asks where a work item is, what is next, or whether to run /dev finish. Rehydrates and reconciles coarse phase first.",
    promptGuidelines: [
      "Prefer dev_work_item_status over ad-hoc file reads when the user asks what is next for a work item.",
    ],
    parameters: Type.Object({ id: Type.String({ description: "Work item ID" }) }),
    handler(params, ctx) {
      const result = devWorkItemStatus(params.id, ctx.getConfig());
      if (!result.ok) return { ok: false, text: result.error };
      return {
        ok: true,
        text: result.value.formatted,
        details: result.value,
      };
    },
  }),

  defineTool({
    name: "dev_subagent_preflight",
    label: "Subagent Preflight",
    description:
      "Validate subagent.json profile, credentials, agent markdown, and spawn timeout before phase spawns",
    promptSnippet:
      "Run before phase-align/spec/plan/test/code or review agents when spawn timeouts or empty responses are suspected. Blocks resume orchestration when credentials are missing.",
    promptGuidelines: [
      "Run dev_subagent_preflight before the first subagent spawn in a session or after editing subagent.json.",
    ],
    parameters: Type.Object({
      agent: Type.Optional(Type.String({ description: "Dispatch agent id (default: phase-plan)" })),
    }),
    handler(params, ctx) {
      const hints = ctx.getSubagentPreflightHints?.();
      const check = runSubagentSpawnPreflightCheck(params.agent ?? "phase-plan", undefined, hints);
      return {
        ok: check.ok,
        text: check.formatted,
        details: check,
      };
    },
  }),

  defineTool({
    name: "dev_workflow_cost",
    label: "Workflow Cost Report",
    description:
      "Token and estimated USD cost rollup for a work item from .tasks/<ID>-usage.jsonl, grouped by pipeline phase and plan task.",
    promptSnippet:
      "Call on /dev finish (before or after verify) to show per-task input/output tokens and total estimated cost.",
    parameters: Type.Object({ id: Type.String({ description: "Work item ID" }) }),
    handler(params) {
      const report = buildWorkflowCostReport(params.id);
      if (!report) return { ok: false, text: `Work item not found: ${params.id}` };
      return {
        ok: true,
        text: report.formatted,
        details: {
          work_item_id: report.work_item_id,
          total_input_tokens: report.total_input_tokens,
          total_output_tokens: report.total_output_tokens,
          total_cost_usd: report.total_cost_usd,
          rows: report.rows,
        },
      };
    },
  }),

  defineTool({
    name: "dev_orchestrate",
    label: "Orchestrate (resume / finish plan)",
    description:
      "Deterministic harness orchestration plan for a work item. `resume` and `finish` return resolution + next_steps (same JSON shape as `accord plan --json`). Set `execute: true` when the host supports programmatic spawn (`ACCORD_MCP_HARNESS=pi|exec` on stdio MCP).",
    promptSnippet:
      "Call with command=resume|finish and work_item_id. Returns enriched plan JSON; MCP with harness configured may execute spawns when execute=true.",
    promptGuidelines: [
      "Use dev_orchestrate for deterministic resume/finish routing; pass execute=true on MCP when ACCORD_MCP_HARNESS is set.",
    ],
    parameters: Type.Object({
      command: Type.Union([Type.Literal("resume"), Type.Literal("finish")]),
      work_item_id: Type.String({ description: "Work item ID" }),
      execute: Type.Optional(
        Type.Boolean({
          description:
            "Run the orchestration loop (not just plan). Defaults to host execute_by_default (true when ACCORD_MCP_HARNESS is set).",
        }),
      ),
    }),
    async handler(params, ctx) {
      const payload = buildDevOrchestratePayload(
        params.command,
        params.work_item_id,
        ctx.getConfig(),
      );
      const hints = ctx.getOrchestrateHostHints?.() ?? {
        programmatic_spawn_supported: false,
      };
      const shouldExecute =
        params.execute === true ||
        (params.execute !== false &&
          hints.execute_by_default === true &&
          hints.programmatic_spawn_supported &&
          ctx.executeOrchestration);
      const execution =
        shouldExecute && ctx.executeOrchestration
          ? await ctx.executeOrchestration(params.command, params.work_item_id)
          : undefined;
      const enriched = enrichDevOrchestratePayload(payload, hints, execution);
      return { ok: true, text: JSON.stringify(enriched, null, 2), details: enriched };
    },
  }),

  defineTool({
    name: "dev_transition",
    label: "Phase Transition",
    description:
      "Atomically update work item phase, set spec/plan/verify/brief paths, and delete checkpoint",
    promptSnippet: "Phase transition with checkpoint cleanup — atomic read-modify-write",
    parameters: Type.Object({
      id: Type.String({ description: "Work item ID" }),
      next_phase: Type.String({ description: "New phase value" }),
      spec: Type.Optional(Type.String({ description: "Spec path to set" })),
      plan: Type.Optional(Type.String({ description: "Plan path to set" })),
      verify: Type.Optional(Type.String({ description: "Verify path to set" })),
      brief: Type.Optional(Type.String({ description: "Brief path to set" })),
    }),
    handler(params) {
      const result = devTransition(params.id, params.next_phase, {
        spec: params.spec,
        plan: params.plan,
        verify: params.verify,
        brief: params.brief,
      });
      if (!result.ok) return { ok: false, text: result.error };
      return {
        ok: true,
        text: `${params.id} → phase: ${params.next_phase}`,
        details: result.value,
      };
    },
  }),

  defineTool({
    name: "dev_finalize",
    label: "Finalise Work Item",
    description:
      "Persist terminal outcome, next action, retro summary, and shift-left findings on a work item",
    promptSnippet:
      "Finalize a work item at the end of verify/report/retro: terminal_outcome, next_action, retro summary, shift-left findings.",
    parameters: Type.Object({
      id: Type.String({ description: "Work item ID" }),
      terminal_outcome: terminalOutcomeEnum,
      next_action: Type.Optional(Type.Union([Type.String(), Type.Null()])),
      retro: Type.Optional(
        Type.Object(
          {
            ran_at: Type.Optional(
              Type.String({ description: "ISO timestamp; auto-filled if omitted" }),
            ),
            verify_verdict: Type.Optional(Type.String()),
            post_run_rework_detected: Type.Optional(Type.Boolean()),
            summary: Type.Optional(Type.String()),
          },
          {
            additionalProperties: true,
            description: "Retrospective object; ran_at is auto-filled if omitted",
          },
        ),
      ),
      shift_left_findings: Type.Optional(
        Type.Array(
          Type.Object({
            category: Type.String(),
            evidence: Type.String(),
            recommendation: Type.String(),
          }),
        ),
      ),
    }),
    handler(params) {
      const result = devFinalizeWorkItem(params.id, {
        terminal_outcome: params.terminal_outcome as import("../types/domain.js").TerminalOutcome,
        next_action: params.next_action,
        retro: params.retro as FinalizeWorkItemInput["retro"],
        shift_left_findings:
          params.shift_left_findings as FinalizeWorkItemInput["shift_left_findings"],
      });
      if (!result.ok) return { ok: false, text: result.error };
      return {
        ok: true,
        text: `${params.id} finalised: ${params.terminal_outcome}`,
        details: result.value,
      };
    },
  }),

  defineTool({
    name: "dev_verify_summary",
    label: "Verify Summary",
    description:
      "Parse a verify report, write verify.md, and return verdict + per-AC status counts + gaps",
    promptSnippet:
      "Summarise verification results — writes a human-readable verify.md, counts pass/fail/partial/not_verified statuses, lists gaps",
    parameters: Type.Object({ id: Type.String({ description: "Work item ID" }) }),
    handler(params) {
      const result = devVerifySummary(params.id);
      if (!result.ok) return { ok: false, text: result.error };
      return { ok: true, text: result.value.formatted, details: result.value };
    },
  }),

  defineTool({
    name: "dev_nonce",
    label: "Generate Nonce",
    description: "Generate a cryptographic nonce for task ownership",
    promptSnippet: "Mint a 6-char hex nonce for phase-code task ownership",
    parameters: Type.Object({}),
    handler() {
      return { ok: true, text: devNonce() };
    },
  }),

  defineTool({
    name: "dev_decision_packet",
    label: "Decision Packet",
    description: "Format a decision packet for the user",
    promptSnippet: "Build the formatted decision packet with pending decision count",
    parameters: Type.Object({
      work_item_id: Type.String(),
      state_label: Type.String({ description: "e.g. 'TASK COMPLETE', 'VERIFICATION COMPLETE'" }),
      fields: Type.Object(
        {},
        {
          additionalProperties: true,
          description: "Key-value pairs to display (non-strings are JSON-stringified)",
        },
      ),
      next_action: Type.String({ description: "What the user should do next" }),
    }),
    handler(params) {
      const text = devDecisionPacket(params.work_item_id, {
        state_label: params.state_label,
        fields: stringifyFieldValues(params.fields as Record<string, unknown>),
        next_action: params.next_action,
      });
      return { ok: true, text };
    },
  }),

  defineTool({
    name: "dev_init_detect",
    label: "Detect Project",
    description: "Detect project stack, infer commands, resolve config placement for /dev init",
    promptSnippet:
      "Deterministic project detection — scans files, infers test/lint/typecheck commands, detects monorepo + tracker, resolves root vs local config placement. Returns a full proposed config + formatted summary for user confirmation.",
    parameters: Type.Object({
      cwd: Type.Optional(
        Type.String({ description: "Directory to scan (defaults to process.cwd())" }),
      ),
    }),
    handler(params) {
      const result = devInitDetect(params.cwd);
      if (!result.ok) {
        return { ok: false, text: result.error.formatted_summary, details: result.error };
      }
      return { ok: true, text: result.value.formatted_summary, details: result.value };
    },
  }),

  defineTool({
    name: "dev_init_write",
    label: "Write Config",
    description: "Write ACCORD config to AGENTS.md (local, root, root_replace, or link_only)",
    promptSnippet:
      "Write the finalised config to AGENTS.md. Handles inline config blocks, dev_harness_ref directives, root vs local placement, and section upsert. Call after user confirms the detected config.",
    parameters: Type.Object({
      config: Type.Object(
        {},
        {
          additionalProperties: true,
          description:
            "The finalised ACCORD config object (after user corrections). See schemas/dev-harness-config-schema.json.",
        },
      ),
      target: initWriteTargetEnum,
      cwd: Type.Optional(
        Type.String({ description: "Current working directory (defaults to process.cwd())" }),
      ),
      git_root: Type.Optional(
        Type.String({ description: "Git root directory. Required when target ≠ 'local'." }),
      ),
    }),
    handler(params) {
      try {
        const result = devInitWrite({
          config: params.config as unknown as DevHarnessConfig,
          target: params.target as WriteTarget,
          cwd: params.cwd ?? process.cwd(),
          git_root: params.git_root,
        });
        return { ok: true, text: result.summary, details: result };
      } catch (e: unknown) {
        return { ok: false, text: `Error: ${e instanceof Error ? e.message : String(e)}` };
      }
    },
  }),
];
