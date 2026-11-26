/**
 * Pi adapter for the morning briefing. Logic lives in accord-core/morning;
 * the same capability ships as the `accord-morning` CLI.
 */

import {
  assembleBriefing,
  emailWeekObjectives,
  formatBriefingSummary,
  formatEmailResult,
  formatMorningRunSummary,
  runMorningPipeline,
  type WeekEmailResult,
} from "@clive.shirley/accord-core/morning/pipeline.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function morningBriefingExtension(pi: ExtensionAPI) {
  pi.registerCommand("morning", {
    description: "Run morning workflow (gather, journal write, objectives email) without LLM",
    handler: async (_args, ctx) => {
      try {
        const result = await runMorningPipeline();
        const text = formatMorningRunSummary(result);
        console.log(text);
        if (ctx.hasUI) {
          ctx.ui.notify(text, "info");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error(`Morning run failed: ${message}`);
        if (ctx.hasUI) {
          ctx.ui.notify(`Morning run failed: ${message}`, "error");
        }
        throw err;
      }
    },
  });

  pi.registerTool({
    exposure: "deferred",
    name: "morning-run",
    label: "Morning Run (gather + journal + email)",
    description:
      "Run the full morning workflow in one call: gather Jira/Slack/Calendar/Gmail, " +
      "write or merge today's work-journal.md entry, then email weekly objectives to " +
      "the line manager (idempotent). Prefer this over chaining separate tools.",
    parameters: Type.Object({
      date: Type.Optional(
        Type.String({
          description: "Override date (YYYY-MM-DD). Normally omit — the tool uses today.",
        }),
      ),
      maxSlack: Type.Optional(
        Type.Number({
          description: "Max actionable Slack items to surface. Defaults to config slack.maxItems.",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const result = await runMorningPipeline(params.date, params.maxSlack);
      const text = formatMorningRunSummary(result);
      return {
        content: [{ type: "text", text }],
        details: result,
      };
    },
  });

  pi.registerTool({
    exposure: "deferred",
    name: "morning-briefing",
    label: "Morning Briefing (composite)",
    description:
      "Assemble the morning briefing deterministically (gather only). " +
      "Gathers Jira (active/backlog/watched) and Slack mentions over HTTP, and Calendar + Gmail " +
      "via the google-workspace MCP server. Returns a `journalPayload` and writes a JSON debug file. " +
      "For the daily workflow use `morning-run` instead.",
    parameters: Type.Object({
      date: Type.Optional(
        Type.String({
          description: "Override date (YYYY-MM-DD). Normally omit — the tool uses today.",
        }),
      ),
      maxSlack: Type.Optional(
        Type.Number({
          description: "Max actionable Slack items to surface. Defaults to config slack.maxItems.",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      const result = await assembleBriefing(params.date, params.maxSlack);
      const text = formatBriefingSummary(result);

      return {
        content: [{ type: "text", text }],
        details: result,
      };
    },
  });

  pi.registerTool({
    exposure: "deferred",
    name: "email-week-objectives",
    label: "Email Weekly Objectives (line manager)",
    description:
      "Review and deliver the current week's objectives email to the line manager. " +
      "Default is review-first: with no `send` flag this only creates/updates a Gmail " +
      "draft and returns a `preview` of the content — nothing is delivered. Check the " +
      "preview (or the draft in Gmail), then call again with `send: true` to actually " +
      "deliver; this is idempotent at-most-ONCE-per-ISO-week for real sends. Reads " +
      "objectives from the `## W/C <monday> OBJECTIVES` block of work-journal.md. For the " +
      "daily workflow use `morning-run` instead (which only ever drafts, never auto-sends).",
    parameters: Type.Object({
      date: Type.Optional(
        Type.String({ description: "Override date (YYYY-MM-DD). Normally omit — uses today." }),
      ),
      to: Type.Optional(
        Type.String({
          description: "Override recipient. Defaults to the configured line manager.",
        }),
      ),
      send: Type.Optional(
        Type.Boolean({
          description:
            "Actually deliver the email (gmail_send). Omit/false to only draft+preview for review.",
        }),
      ),
      draft: Type.Optional(
        Type.Boolean({ description: "Deprecated alias: draft:false behaves like send:true." }),
      ),
      force: Type.Optional(
        Type.Boolean({ description: "Bypass the once-per-week guard (for re-drafting/testing)." }),
      ),
    }),
    async execute(_toolCallId, params) {
      const r = await emailWeekObjectives({
        date: params.date,
        to: params.to,
        draft: params.draft,
        send: params.send,
        force: params.force,
      });

      const text = formatEmailResult(r);

      return {
        content: [{ type: "text", text }],
        details: r,
      };
    },
  });
}
