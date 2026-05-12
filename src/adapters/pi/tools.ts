/**
 * Tool registrations — thin wrappers that expose orchestrator
 * functions as pi tools callable by the LLM.
 * `dev_*` tool names and declaration order must match `../accord-dev-tool-names.ts` (enforced by tests).
 */

import { StringEnum } from "@mariozechner/pi-ai";
import type { AgentToolResult, ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import { devCodeBrief, devNonce, devQuickFixBrief } from "../../core/briefing/code-brief.js";
import { devDecisionPacket } from "../../core/briefing/decision-packet.js";
import type { IntentRecommendation } from "../../core/commands/intent.js";
import {
  formatIntentRecommendation,
  formatRefinementResult,
  recommendIntentMode,
  refineWithTicketSignals,
} from "../../core/commands/intent.js";
import type { DevHarnessConfig } from "../../core/config/index.js";
import { devInitDetect } from "../../core/config/init-detect.js";
import { devInitWrite, type WriteTarget } from "../../core/config/init-write.js";
import { devTasks } from "../../core/queries/dashboard.js";
import { devResumeState } from "../../core/queries/resume-state.js";
import { devRetro } from "../../core/queries/retro.js";
import { devReviewQueue } from "../../core/queries/review-queue.js";
import { devSpecGaps } from "../../core/queries/spec-gaps.js";
import { devVerifySummary } from "../../core/queries/verify-summary.js";
import {
  devCheckpointDelete,
  devCheckpointRead,
  devCheckpointWrite,
} from "../../core/work-items/checkpoint.js";
import {
  devBootstrap,
  devFinalizeWorkItem,
  devPromoteEvents,
  devTransition,
} from "../../core/work-items/lifecycle.js";
import type { Checkpoint } from "../../core/work-items/types.js";

function ok(text: string, details?: unknown): AgentToolResult<unknown> {
  return { content: [{ type: "text", text }], details };
}

function err(text: string): AgentToolResult<unknown> {
  return { content: [{ type: "text", text: `⚠ ${text}` }], details: undefined };
}

/** @see ../accord-dev-tool-names.ts */
export function registerTools(pi: ExtensionAPI, getConfig: () => DevHarnessConfig | null): void {
  pi.registerTool({
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
    async execute(_id, params) {
      const result = recommendIntentMode(params.text, params.brief);
      return ok(formatIntentRecommendation(result), result);
    },
  });

  pi.registerTool({
    name: "dev_intent_enrich",
    label: "Enrich Intent",
    description:
      "Refine an intent recommendation using ticket metadata (AC count, story points, subtasks, etc.)",
    promptSnippet:
      "After dev_intent returns medium/low confidence and a ticket ID is present, fetch the ticket then call this with the initial recommendation + ticket signals to upgrade/downgrade the pattern.",
    parameters: Type.Object({
      recommendation: Type.Object(
        {
          intent_mode: StringEnum([
            "narrow_change",
            "pipeline",
            "review",
            "commit",
            "explain",
            "investigate",
          ] as const),
          confidence: StringEnum(["high", "medium", "low"] as const),
          reasons: Type.Array(Type.String()),
          needs_confirmation: Type.Boolean(),
          escalation_ceiling: StringEnum([
            "pipeline_allowed",
            "no_pipeline_without_confirmation",
            "no_implementation_without_confirmation",
            "read_only_until_confirmed",
            "no_edits",
          ] as const),
          target_paths: Type.Array(Type.String()),
          out_of_scope: Type.Array(Type.String()),
          recommended_pattern: Type.Optional(
            StringEnum(["implement", "quick_fix", "investigate", "infra", "analyse"] as const),
          ),
          recommended_variant: Type.Optional(
            StringEnum(["express", "standard", "orchestrated"] as const),
          ),
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
    async execute(_id, params) {
      const result = refineWithTicketSignals(
        params.recommendation as IntentRecommendation,
        params.ticket_signals,
      );
      return ok(formatRefinementResult(result), result);
    },
  });

  pi.registerTool({
    name: "dev_tasks",
    label: "Work Items",
    description: "Dashboard of active work items in .tasks/",
    promptSnippet: "Show work item dashboard with task status, costs, and pending decisions",
    parameters: Type.Object({}),
    async execute() {
      const result = devTasks();
      return ok(result.formatted, result);
    },
  });

  pi.registerTool({
    name: "dev_bootstrap",
    label: "Bootstrap Work Item",
    description: "Create a new work item JSON in .tasks/",
    promptSnippet: "Bootstrap a new work item with correct schema, timestamps, and entry phase",
    parameters: Type.Object({
      id: Type.String({ description: "Work item ID (e.g. ACCORD-1234)" }),
      title: Type.String({ description: "Short title" }),
      pattern: StringEnum(["implement", "quick_fix", "investigate", "infra", "analyse"] as const, {
        description: "Pattern: implement, quick_fix, investigate, infra, analyse",
      }),
      variant: Type.Optional(
        Type.String({ description: "Variant: standard, express, orchestrated" }),
      ),
      intent_mode: Type.Optional(
        StringEnum([
          "narrow_change",
          "pipeline",
          "review",
          "commit",
          "explain",
          "investigate",
        ] as const),
      ),
      intent_confidence: Type.Optional(StringEnum(["high", "medium", "low"] as const)),
      escalation_ceiling: Type.Optional(
        StringEnum([
          "pipeline_allowed",
          "no_pipeline_without_confirmation",
          "no_implementation_without_confirmation",
          "read_only_until_confirmed",
          "no_edits",
        ] as const),
      ),
      target_paths: Type.Optional(Type.Array(Type.String())),
      out_of_scope: Type.Optional(Type.Array(Type.String())),
      expected_finish: Type.Optional(
        Type.String({ description: "Short description of the user-visible finish condition" }),
      ),
    }),
    async execute(_id, params) {
      const result = devBootstrap(params.id, params.title, params.pattern, params.variant, {
        intent_mode: params.intent_mode,
        intent_confidence: params.intent_confidence,
        escalation_ceiling: params.escalation_ceiling,
        target_paths: params.target_paths,
        out_of_scope: params.out_of_scope,
        expected_finish: params.expected_finish,
      });
      return ok(`Created ${result.path} (phase: ${result.work_item.phase})`, result);
    },
  });

  pi.registerTool({
    name: "dev_checkpoint",
    label: "Checkpoint",
    description: "Read, write, or delete a checkpoint file for multi-turn phases",
    promptSnippet: "Manage checkpoint state for spec/plan multi-turn phases",
    parameters: Type.Object({
      id: Type.String({ description: "Work item ID" }),
      action: StringEnum(["read", "write", "delete"] as const),
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
    async execute(_id, params) {
      if (params.action === "read") {
        const cp = devCheckpointRead(params.id);
        if (!cp) return ok("No checkpoint found.");
        return ok(JSON.stringify(cp, null, 2), cp);
      }
      if (params.action === "write") {
        if (!params.data || typeof params.data !== "object") {
          return err("dev_checkpoint write requires a 'data' object");
        }
        const result = devCheckpointWrite(params.id, params.data as Checkpoint);
        return ok(`Checkpoint written: ${result.path}`);
      }
      const deleted = devCheckpointDelete(params.id);
      return ok(deleted ? "Checkpoint deleted." : "No checkpoint to delete.");
    },
  });

  pi.registerTool({
    name: "dev_review_queue",
    label: "Review Queue",
    description: "Collect pending decisions and deviations across all work items",
    promptSnippet:
      "Gather the review queue — pending decisions sorted by asked_at, deviations sorted by at",
    parameters: Type.Object({}),
    async execute() {
      const result = devReviewQueue();
      return ok(result.formatted, result);
    },
  });

  pi.registerTool({
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
    async execute(_id, params) {
      const result = devRetro({
        insights_dir: params.insights_dir,
        include_legacy_heuristic: params.include_legacy_heuristic,
        limit: params.limit,
        since: params.since,
        work_item_id: params.work_item_id,
      });
      if ("error" in result) return err(result.error);
      return ok(result.formatted, result);
    },
  });

  pi.registerTool({
    name: "dev_promote_events",
    label: "Promote Events",
    description: "Promote events from a per-task file to the parent work item",
    promptSnippet:
      "Process task events: escalations → decisions[], deviations → deviations[], request_review → review agents",
    parameters: Type.Object({
      work_item_id: Type.String(),
      task_id: Type.String(),
    }),
    async execute(_id, params) {
      const result = devPromoteEvents(params.work_item_id, params.task_id);
      const parts: string[] = [];
      if (result.escalations_added > 0)
        parts.push(`${result.escalations_added} escalation(s) → decisions[]`);
      if (result.deviations_added > 0) parts.push(`${result.deviations_added} deviation(s) added`);
      if (result.review_requested)
        parts.push(`Review requested: ${result.review_agents.join(", ")}`);
      if (parts.length === 0) parts.push("No new events to promote.");
      return ok(parts.join("\n"), result);
    },
  });

  pi.registerTool({
    name: "dev_spec_gaps",
    label: "Spec Gaps",
    description: "Run the 10-point spec-gaps checklist against a finalised spec",
    promptSnippet: "Deterministic spec-gaps check — inspects JSON fields, no LLM reasoning needed",
    parameters: Type.Object({ id: Type.String({ description: "Work item ID" }) }),
    async execute(_id, params) {
      const result = devSpecGaps(params.id);
      if ("error" in result) return err(result.error);
      return ok(result.formatted, result);
    },
  });

  pi.registerTool({
    name: "dev_code_brief",
    label: "Code Brief",
    description: "Assemble a complete phase-code brief from spec, plan, and task data",
    promptSnippet:
      "Build the code task brief with all context — avoids loading raw JSON into orchestrator context",
    parameters: Type.Object({
      work_item_id: Type.String(),
      task_id: Type.String(),
    }),
    async execute(_id, params) {
      const result = devCodeBrief(params.work_item_id, params.task_id, getConfig());
      if ("error" in result) return err(result.error);
      return ok(result.brief, { brief_length: result.brief.length });
    },
  });

  pi.registerTool({
    name: "dev_quick_fix_brief",
    label: "Quick Fix Brief",
    description:
      "Create quick_fix task state, write spec/plan stubs, and assemble a phase-test or phase-code brief",
    promptSnippet:
      "For quick_fix/fixing work items only: create .tasks/<ID>-task-1.json, write auto-generated spec/plan stubs to docs/dev/<ID>/, persist task_ids and spec/plan paths on the work item, and return a brief. Returns brief_type='phase-test' when strategy is new_red_test (spawn phase-test first), or brief_type='phase-code' otherwise (uses dev_code_brief against the stubs). After phase-test/review-test, call dev_code_brief for the phase-code brief.",
    parameters: Type.Object({
      work_item_id: Type.String(),
    }),
    async execute(_id, params) {
      const result = devQuickFixBrief(params.work_item_id, getConfig());
      if ("error" in result) return err(result.error);
      return ok(result.brief, {
        task_file_path: result.task_file_path,
        task_id: result.task_id,
        brief_type: result.brief_type,
      });
    },
  });

  pi.registerTool({
    name: "dev_resume_state",
    label: "Resume State",
    description: "Read work item + checkpoint state for /dev resume routing",
    promptSnippet: "Get resume state: phase, checkpoint presence, pattern — for dispatch routing",
    parameters: Type.Object({ id: Type.String({ description: "Work item ID" }) }),
    async execute(_id, params) {
      const result = devResumeState(params.id);
      if ("error" in result) return err(result.error);
      return ok(
        `${result.id}: phase=${result.phase}, checkpoint=${result.has_checkpoint}, pattern=${result.pattern}`,
        result,
      );
    },
  });

  pi.registerTool({
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
    async execute(_id, params) {
      const result = devTransition(params.id, params.next_phase, {
        spec: params.spec,
        plan: params.plan,
        verify: params.verify,
        brief: params.brief,
      });
      if ("error" in result) return err(result.error);
      return ok(`${params.id} → phase: ${params.next_phase}`, result);
    },
  });

  pi.registerTool({
    name: "dev_finalize",
    label: "Finalise Work Item",
    description:
      "Persist terminal outcome, next action, retro summary, and shift-left findings on a work item",
    promptSnippet:
      "Finalize a work item at the end of verify/report/retro: terminal_outcome, next_action, retro summary, shift-left findings.",
    parameters: Type.Object({
      id: Type.String({ description: "Work item ID" }),
      terminal_outcome: StringEnum(["done", "blocked", "partially_achieved", "unclear"] as const),
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
    async execute(_id, params) {
      const result = devFinalizeWorkItem(params.id, {
        terminal_outcome: params.terminal_outcome,
        next_action: params.next_action,
        retro: params.retro,
        shift_left_findings: params.shift_left_findings,
      });
      if ("error" in result) return err(result.error);
      return ok(`${params.id} finalised: ${params.terminal_outcome}`, result);
    },
  });

  pi.registerTool({
    name: "dev_verify_summary",
    label: "Verify Summary",
    description:
      "Parse a verify report, write verify.md, and return verdict + per-AC status counts + gaps",
    promptSnippet:
      "Summarise verification results — writes a human-readable verify.md, counts pass/fail/partial/not_verified statuses, lists gaps",
    parameters: Type.Object({ id: Type.String({ description: "Work item ID" }) }),
    async execute(_id, params) {
      const result = devVerifySummary(params.id);
      if ("error" in result) return err(result.error);
      return ok(result.formatted, result);
    },
  });

  pi.registerTool({
    name: "dev_nonce",
    label: "Generate Nonce",
    description: "Generate a cryptographic nonce for task ownership",
    promptSnippet: "Mint a 6-char hex nonce for phase-code task ownership",
    parameters: Type.Object({}),
    async execute() {
      return ok(devNonce());
    },
  });

  pi.registerTool({
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
          description: "Key-value pairs to display (object, not array)",
        },
      ),
      next_action: Type.String({ description: "What the user should do next" }),
    }),
    async execute(_id, params) {
      const text = devDecisionPacket(params.work_item_id, {
        state_label: params.state_label,
        fields: params.fields as Record<string, string>,
        next_action: params.next_action,
      });
      return ok(text);
    },
  });

  // ── /dev init tools ────────────────────────────────────────

  pi.registerTool({
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
    async execute(_id, params) {
      const result = devInitDetect(params.cwd);
      if (!result.proposed_config) {
        return {
          content: [{ type: "text" as const, text: `⚠ ${result.formatted_summary}` }],
          details: result,
        };
      }
      return ok(result.formatted_summary, result);
    },
  });

  pi.registerTool({
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
      target: StringEnum(["local", "root", "root_replace", "link_only"] as const, {
        description:
          "Where to write: 'local' (cwd only), 'root' (root + link), 'root_replace' (replace root + link), 'link_only' (ref directive only)",
      }),
      cwd: Type.Optional(
        Type.String({ description: "Current working directory (defaults to process.cwd())" }),
      ),
      git_root: Type.Optional(
        Type.String({ description: "Git root directory. Required when target ≠ 'local'." }),
      ),
    }),
    async execute(_id, params) {
      try {
        const result = devInitWrite({
          config: params.config as DevHarnessConfig,
          target: params.target as WriteTarget,
          cwd: params.cwd ?? process.cwd(),
          git_root: params.git_root,
        });
        return ok(result.summary, result);
      } catch (e: unknown) {
        return err(`Error: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  });
}
