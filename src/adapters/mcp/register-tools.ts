/**
 * Registers ACCORD `dev_*` tools on an MCP server — same surface as adapters/pi/tools.ts.
 * Tool names and declaration order must match `../accord-dev-tool-names.ts` (enforced by tests).
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { DevHarnessConfig } from "../../core/config/index.js";
import type { IntentRecommendation } from "../../core/commands/intent.js";
import { formatIntentRecommendation, formatRefinementResult, recommendIntentMode, refineWithTicketSignals } from "../../core/commands/intent.js";
import { devTasks } from "../../core/queries/dashboard.js";
import { devReviewQueue } from "../../core/queries/review-queue.js";
import { devSpecGaps } from "../../core/queries/spec-gaps.js";
import { devVerifySummary } from "../../core/queries/verify-summary.js";
import { devResumeState } from "../../core/queries/resume-state.js";
import { devRetro } from "../../core/queries/retro.js";
import {
  devBootstrap,
  devFinalizeWorkItem,
  devTransition,
  devPromoteEvents,
  type FinalizeWorkItemInput,
} from "../../core/work-items/lifecycle.js";
import type { Checkpoint } from "../../core/work-items/types.js";
import { devCheckpointRead, devCheckpointWrite, devCheckpointDelete } from "../../core/work-items/checkpoint.js";
import { devCodeBrief, devQuickFixBrief, devNonce } from "../../core/briefing/code-brief.js";
import { devDecisionPacket } from "../../core/briefing/decision-packet.js";
import { devInitDetect } from "../../core/config/init-detect.js";
import { devInitWrite, type WriteTarget } from "../../core/config/init-write.js";

function stringifyFieldValues(fields: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [
      k,
      typeof v === "string" ? v : JSON.stringify(v),
    ]),
  );
}

function ok(text: string, details?: unknown) {
  const body =
    details === undefined ? text : `${text}\n---\n${JSON.stringify(details, null, 2)}`;
  return { content: [{ type: "text" as const, text: body }] };
}

function toolErr(text: string) {
  return { content: [{ type: "text" as const, text: `⚠ ${text}` }], isError: true as const };
}

const intentModeZ = z.enum([
  "narrow_change",
  "pipeline",
  "review",
  "commit",
  "explain",
  "investigate",
]);

const confidenceZ = z.enum(["high", "medium", "low"]);

const escalationCeilingZ = z.enum([
  "pipeline_allowed",
  "no_pipeline_without_confirmation",
  "no_implementation_without_confirmation",
  "read_only_until_confirmed",
  "no_edits",
]);

const patternZ = z.enum(["implement", "quick_fix", "investigate", "infra", "analyse"]);

const variantZ = z.enum(["express", "standard", "orchestrated"]);

const intentRecommendationZ = z.object({
  intent_mode: intentModeZ,
  confidence: confidenceZ,
  reasons: z.array(z.string()),
  needs_confirmation: z.boolean(),
  escalation_ceiling: escalationCeilingZ,
  target_paths: z.array(z.string()),
  out_of_scope: z.array(z.string()),
  recommended_pattern: patternZ.optional(),
  recommended_variant: variantZ.optional(),
});

const ticketSignalsZ = z.object({
  issue_type: z.string().optional(),
  story_points: z.number().optional(),
  ac_count: z.number().optional(),
  description_length: z.number().optional(),
  subtask_count: z.number().optional(),
  linked_issue_count: z.number().optional(),
});

/** @see ../accord-dev-tool-names.ts */
export function registerAccordMcpTools(
  mcp: McpServer,
  getConfig: () => DevHarnessConfig | null,
): void {
  mcp.registerTool(
    "dev_intent",
    {
      description: "Recommend an ACCORD intent mode from the user's ask/brief",
      inputSchema: {
        text: z.string().describe("User ask or concise work description"),
        brief: z.string().optional().describe("Optional existing brief/context"),
      },
    },
    async ({ text, brief }) => {
      const result = recommendIntentMode(text, brief);
      return ok(formatIntentRecommendation(result), result);
    },
  );

  mcp.registerTool(
    "dev_intent_enrich",
    {
      description:
        "Refine an intent recommendation using ticket metadata (AC count, story points, subtasks, etc.)",
      inputSchema: {
        recommendation: intentRecommendationZ.describe("The recommendation returned by dev_intent"),
        ticket_signals: ticketSignalsZ.describe("Signals extracted from the ticket"),
      },
    },
    async ({ recommendation, ticket_signals }) => {
      const result = refineWithTicketSignals(
        recommendation as IntentRecommendation,
        ticket_signals,
      );
      return ok(formatRefinementResult(result), result);
    },
  );

  mcp.registerTool(
    "dev_tasks",
    { description: "Dashboard of active work items in .tasks/" },
    async () => {
      const result = devTasks();
      return ok(result.formatted, result);
    },
  );

  mcp.registerTool(
    "dev_bootstrap",
    {
      description: "Create a new work item JSON in .tasks/",
      inputSchema: {
        id: z.string().describe("Work item ID (e.g. ACCORD-1234)"),
        title: z.string().describe("Short title"),
        pattern: patternZ.describe("Pattern: implement, quick_fix, investigate, infra, analyse"),
        variant: z.string().optional().describe("Variant: standard, express, orchestrated"),
        intent_mode: intentModeZ.optional(),
        intent_confidence: confidenceZ.optional(),
        escalation_ceiling: escalationCeilingZ.optional(),
        target_paths: z.array(z.string()).optional(),
        out_of_scope: z.array(z.string()).optional(),
        expected_finish: z
          .string()
          .optional()
          .describe("Short description of the user-visible finish condition"),
      },
    },
    async (params) => {
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
  );

  mcp.registerTool(
    "dev_checkpoint",
    {
      description: "Read, write, or delete a checkpoint file for multi-turn phases",
      inputSchema: {
        id: z.string().describe("Work item ID"),
        action: z.enum(["read", "write", "delete"]),
        data: z
          .record(z.string(), z.unknown())
          .optional()
          .describe(
            "Checkpoint data object (required for write). schema_version is normalised by the harness.",
          ),
      },
    },
    async ({ id, action, data }) => {
      if (action === "read") {
        const cp = devCheckpointRead(id);
        if (!cp) return ok("No checkpoint found.");
        return ok(JSON.stringify(cp, null, 2), cp);
      }
      if (action === "write") {
        if (!data || typeof data !== "object") {
          return toolErr("dev_checkpoint write requires a 'data' object");
        }
        const result = devCheckpointWrite(id, data as unknown as Checkpoint);
        return ok(`Checkpoint written: ${result.path}`);
      }
      const deleted = devCheckpointDelete(id);
      return ok(deleted ? "Checkpoint deleted." : "No checkpoint to delete.");
    },
  );

  mcp.registerTool(
    "dev_review_queue",
    { description: "Collect pending decisions and deviations across all work items" },
    async () => {
      const result = devReviewQueue();
      return ok(result.formatted, result);
    },
  );

  mcp.registerTool(
    "dev_retro",
    {
      description: "Analyse pi-insights sessions associated with ACCORD runs",
      inputSchema: {
        insights_dir: z
          .string()
          .optional()
          .describe("Path to pi-insights directory (defaults to ./insights or ~/.config/pi/agent/insights)"),
        include_legacy_heuristic: z
          .boolean()
          .optional()
          .describe("Also include pre-marker sessions that mention /dev, .tasks, or phase agents (default true)"),
        limit: z.number().optional().describe("Maximum representative sessions to return (default 50)"),
        since: z.string().optional().describe("Only include sessions since this ISO date/time"),
        work_item_id: z
          .string()
          .optional()
          .describe("Only include sessions associated with this work item ID"),
      },
    },
    async (params) => {
      const result = devRetro({
        insights_dir: params.insights_dir,
        include_legacy_heuristic: params.include_legacy_heuristic,
        limit: params.limit,
        since: params.since,
        work_item_id: params.work_item_id,
      });
      if ("error" in result) return toolErr(result.error);
      return ok(result.formatted, result);
    },
  );

  mcp.registerTool(
    "dev_promote_events",
    {
      description: "Promote events from a per-task file to the parent work item",
      inputSchema: {
        work_item_id: z.string(),
        task_id: z.string(),
      },
    },
    async ({ work_item_id, task_id }) => {
      const result = devPromoteEvents(work_item_id, task_id);
      const parts: string[] = [];
      if (result.escalations_added > 0) {
        parts.push(`${result.escalations_added} escalation(s) → decisions[]`);
      }
      if (result.deviations_added > 0) parts.push(`${result.deviations_added} deviation(s) added`);
      if (result.review_requested) {
        parts.push(`Review requested: ${result.review_agents.join(", ")}`);
      }
      if (parts.length === 0) parts.push("No new events to promote.");
      return ok(parts.join("\n"), result);
    },
  );

  mcp.registerTool(
    "dev_spec_gaps",
    {
      description: "Run the 10-point spec-gaps checklist against a finalised spec",
      inputSchema: { id: z.string().describe("Work item ID") },
    },
    async ({ id }) => {
      const result = devSpecGaps(id);
      if ("error" in result) return toolErr(result.error);
      return ok(result.formatted, result);
    },
  );

  mcp.registerTool(
    "dev_code_brief",
    {
      description: "Assemble a complete phase-code brief from spec, plan, and task data",
      inputSchema: {
        work_item_id: z.string(),
        task_id: z.string(),
      },
    },
    async ({ work_item_id, task_id }) => {
      const result = devCodeBrief(work_item_id, task_id, getConfig());
      if ("error" in result) return toolErr(result.error);
      return ok(result.brief, { brief_length: result.brief.length });
    },
  );

  mcp.registerTool(
    "dev_quick_fix_brief",
    {
      description:
        "Create quick_fix task state, write spec/plan stubs, and assemble a phase-test or phase-code brief",
      inputSchema: { work_item_id: z.string() },
    },
    async ({ work_item_id }) => {
      const result = devQuickFixBrief(work_item_id, getConfig());
      if ("error" in result) return toolErr(result.error);
      return ok(result.brief, {
        task_file_path: result.task_file_path,
        task_id: result.task_id,
        brief_type: result.brief_type,
      });
    },
  );

  mcp.registerTool(
    "dev_resume_state",
    {
      description: "Read work item + checkpoint state for /dev resume routing",
      inputSchema: { id: z.string().describe("Work item ID") },
    },
    async ({ id }) => {
      const result = devResumeState(id);
      if ("error" in result) return toolErr(result.error);
      return ok(
        `${result.id}: phase=${result.phase}, checkpoint=${result.has_checkpoint}, pattern=${result.pattern}`,
        result,
      );
    },
  );

  mcp.registerTool(
    "dev_transition",
    {
      description:
        "Atomically update work item phase, set spec/plan/verify/brief paths, and delete checkpoint",
      inputSchema: {
        id: z.string().describe("Work item ID"),
        next_phase: z.string().describe("New phase value"),
        spec: z.string().optional().describe("Spec path to set"),
        plan: z.string().optional().describe("Plan path to set"),
        verify: z.string().optional().describe("Verify path to set"),
        brief: z.string().optional().describe("Brief path to set"),
      },
    },
    async (params) => {
      const result = devTransition(params.id, params.next_phase, {
        spec: params.spec,
        plan: params.plan,
        verify: params.verify,
        brief: params.brief,
      });
      if ("error" in result) return toolErr(result.error);
      return ok(`${params.id} → phase: ${params.next_phase}`, result);
    },
  );

  mcp.registerTool(
    "dev_finalize",
    {
      description:
        "Persist terminal outcome, next action, retro summary, and shift-left findings on a work item",
      inputSchema: {
        id: z.string().describe("Work item ID"),
        terminal_outcome: z.enum(["done", "blocked", "partially_achieved", "unclear"]),
        next_action: z.union([z.string(), z.null()]).optional(),
        retro: z
          .object({
            ran_at: z.string().optional(),
            verify_verdict: z.string().optional(),
            post_run_rework_detected: z.boolean().optional(),
            summary: z.string().optional(),
          })
          .passthrough()
          .optional()
          .describe("Retrospective object; ran_at is auto-filled if omitted"),
        shift_left_findings: z
          .array(
            z.object({
              category: z.string(),
              evidence: z.string(),
              recommendation: z.string(),
            }),
          )
          .optional(),
      },
    },
    async (params) => {
      const result = devFinalizeWorkItem(params.id, {
        terminal_outcome: params.terminal_outcome,
        next_action: params.next_action,
        retro: params.retro as FinalizeWorkItemInput["retro"],
        shift_left_findings: params.shift_left_findings,
      });
      if ("error" in result) return toolErr(result.error);
      return ok(`${params.id} finalised: ${params.terminal_outcome}`, result);
    },
  );

  mcp.registerTool(
    "dev_verify_summary",
    {
      description:
        "Parse a verify report, write verify.md, and return verdict + per-AC status counts + gaps",
      inputSchema: { id: z.string().describe("Work item ID") },
    },
    async ({ id }) => {
      const result = devVerifySummary(id);
      if ("error" in result) return toolErr(result.error);
      return ok(result.formatted, result);
    },
  );

  mcp.registerTool(
    "dev_nonce",
    { description: "Generate a cryptographic nonce for task ownership" },
    async () => ok(devNonce()),
  );

  mcp.registerTool(
    "dev_decision_packet",
    {
      description: "Format a decision packet for the user",
      inputSchema: {
        work_item_id: z.string(),
        state_label: z.string().describe("e.g. 'TASK COMPLETE', 'VERIFICATION COMPLETE'"),
        fields: z
          .record(z.string(), z.unknown())
          .describe("Key-value pairs to display (non-strings are JSON-stringified)"),
        next_action: z.string().describe("What the user should do next"),
      },
    },
    async ({ work_item_id, state_label, fields, next_action }) => {
      const text = devDecisionPacket(work_item_id, {
        state_label,
        fields: stringifyFieldValues(fields),
        next_action,
      });
      return ok(text);
    },
  );

  mcp.registerTool(
    "dev_init_detect",
    {
      description:
        "Detect project stack, infer commands, resolve config placement for /dev init",
      inputSchema: {
        cwd: z.string().optional().describe("Directory to scan (defaults to process cwd)"),
      },
    },
    async ({ cwd }) => {
      const result = devInitDetect(cwd);
      if (!result.proposed_config) {
        return toolErr(result.formatted_summary);
      }
      return ok(result.formatted_summary, result);
    },
  );

  mcp.registerTool(
    "dev_init_write",
    {
      description: "Write ACCORD config to AGENTS.md (local, root, root_replace, or link_only)",
      inputSchema: {
        config: z.record(z.string(), z.unknown()).describe("The finalised ACCORD config object"),
        target: z
          .enum(["local", "root", "root_replace", "link_only"])
          .describe(
            "Where to write: local (cwd only), root (root + link), root_replace (replace root + link), link_only (ref directive only)",
          ),
        cwd: z.string().optional().describe("Current working directory (defaults to process cwd)"),
        git_root: z.string().optional().describe("Git root directory. Required when target ≠ local."),
      },
    },
    async (params) => {
      try {
        const result = devInitWrite({
          config: params.config as unknown as DevHarnessConfig,
          target: params.target as WriteTarget,
          cwd: params.cwd ?? process.cwd(),
          git_root: params.git_root,
        });
        return ok(result.summary, result);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return toolErr(`Error: ${msg}`);
      }
    },
  );
}
