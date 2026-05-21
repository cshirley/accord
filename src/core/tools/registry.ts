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
import { buildDevOrchestratePayload } from "../orchestration/plan.js";
import { devTasks } from "../queries/dashboard.js";
import { devResumeState } from "../queries/resume-state.js";
import { devRehydrateWorkItem } from "../work-items/rehydrate.js";
import { devRetro } from "../queries/retro.js";
import { devReviewQueue } from "../queries/review-queue.js";
import { devSpecGaps } from "../queries/spec-gaps.js";
import { devVerifySummary } from "../queries/verify-summary.js";
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
      const result = devBootstrap(params.id, params.title, params.pattern, params.variant, {
        intent_mode: params.intent_mode,
        intent_confidence: params.intent_confidence,
        escalation_ceiling: params.escalation_ceiling,
        target_paths: params.target_paths,
        out_of_scope: params.out_of_scope,
        expected_finish: params.expected_finish,
      });
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
        details: { brief_length: result.value.brief.length },
      };
    },
  }),

  defineTool({
    name: "dev_quick_fix_brief",
    label: "Quick Fix Brief",
    description:
      "Create quick_fix task state, write spec/plan stubs, and assemble a phase-test or phase-code brief",
    promptSnippet:
      "For quick_fix/fixing work items only: create .tasks/<ID>-task-1.json, write auto-generated spec/plan stubs to docs/dev/<ID>/, persist task_ids and spec/plan paths on the work item, and return a brief. Returns brief_type='phase-test' when strategy is new_red_test (spawn phase-test first), or brief_type='phase-code' otherwise (uses dev_code_brief against the stubs). After phase-test/review-test, call dev_code_brief for the phase-code brief.",
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
    name: "dev_orchestrate",
    label: "Orchestrate (resume / finish plan)",
    description:
      "Deterministic harness orchestration plan for a work item. `resume` and `finish` return resolution + next_steps; when judgment is configured for a resume spawn, also includes judgment_configured_for_spawn and spawn_task_after_template_judgment (template merge — MCP cannot run the judgment LLM). MCP clients cannot spawn Pi subagents programmatically — use the payload to decide external actions.",
    promptSnippet:
      "Call with command=resume|finish and work_item_id. Same routing as ACCORD_CORE_ORCHESTRATOR paths without executing spawn.",
    parameters: Type.Object({
      command: Type.Union([Type.Literal("resume"), Type.Literal("finish")]),
      work_item_id: Type.String({ description: "Work item ID" }),
    }),
    handler(params, ctx) {
      const payload = buildDevOrchestratePayload(
        params.command,
        params.work_item_id,
        ctx.getConfig(),
      );
      return { ok: true, text: JSON.stringify(payload, null, 2), details: payload };
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
        terminal_outcome: params.terminal_outcome,
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
