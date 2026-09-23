/**
 * Deterministic handling for `/dev` free-text (classify) before orchestration continues.
 *
 * Same rules as `dev_intent`, then optional `dev_bootstrap` when the line is unambiguous
 * (ticket-only, ticket + title, high-confidence intent, work item missing).
 */

import { loadWorkItem } from "../work-items/io.js";
import { devBootstrap, type IntentContractInput } from "../work-items/lifecycle.js";
import { ensureWorkItemHydrated } from "../work-items/rehydrate.js";
import type { WorkItemPattern } from "../work-items/types.js";
import { DEV_WORK_ITEM_ID_PATTERN } from "./dispatch.js";
import {
  formatIntentRecommendation,
  type IntentRecommendation,
  recommendIntentMode,
} from "./intent.js";

/** Leading tracker-style key: `PROJ-1`, `ACCORD-1234`, `FOO-BAR-9`. */
const LEADING_TICKET_TITLE = /^([A-Z]+(?:-[A-Z]+)*-\d+)\s+(.+)$/;

const MIN_TITLE_LEN = 4;

export interface ClassifyPreflightResult {
  intent: IntentRecommendation;
  intentBlock: string;
  /** User-visible line when deterministic bootstrap ran or was intentionally skipped. */
  bootstrapNotice?: string;
}

export interface ClassifyBootstrapInput {
  id: string;
  title: string;
  text: string;
  intent: IntentRecommendation;
  /** Ticket-only lines (`STEP-11488`) — explicit harness start on that work item. */
  ticketOnly: boolean;
}

function resolveBootstrapPatternVariant(
  intent: IntentRecommendation,
  text: string,
): { pattern: WorkItemPattern; variant?: string } | null {
  if (
    intent.intent_mode === "commit" ||
    intent.intent_mode === "review" ||
    intent.intent_mode === "explain"
  ) {
    return null;
  }

  if (/\b(terraform|helm|kubernetes|pulumi|cloudformation|iac)\b/i.test(text)) {
    return { pattern: "infra" };
  }

  const express = /\bexpress\b/i.test(text);
  const orchestrated = /\b(orchestrated|parallelis[sz]able|worktrees?)\b/i.test(text);

  if (intent.recommended_pattern) {
    const variant =
      intent.recommended_variant ??
      (intent.recommended_pattern === "implement"
        ? express
          ? "express"
          : orchestrated
            ? "orchestrated"
            : "standard"
        : undefined);
    return { pattern: intent.recommended_pattern, variant };
  }

  switch (intent.intent_mode) {
    case "pipeline":
      return {
        pattern: "implement",
        variant: express ? "express" : orchestrated ? "orchestrated" : "standard",
      };
    case "narrow_change":
      return { pattern: "quick_fix" };
    case "investigate":
      return { pattern: "investigate" };
    default:
      return null;
  }
}

/** Intent contract for `/dev STEP-11488` — named ticket is explicit consent to start the harness. */
function intentForTicketOnlyBootstrap(base: IntentRecommendation): IntentRecommendation {
  return {
    ...base,
    intent_mode: "pipeline",
    confidence: "high",
    needs_confirmation: false,
    escalation_ceiling: "pipeline_allowed",
    recommended_pattern: "implement",
    recommended_variant: "standard",
    reasons: [
      ...base.reasons,
      "ticket-only input: start implement/standard on the named work item",
    ],
  };
}

function parseLeadingTicketAndTitle(text: string): { id: string; title: string } | null {
  const trimmed = text.trim();
  const match = LEADING_TICKET_TITLE.exec(trimmed);
  if (!match) return null;
  const id = match[1];
  const title = match[2].trim();
  if (title.length < MIN_TITLE_LEN) return null;
  return { id, title };
}

/** Input is only a tracker key (no description suffix). */
export function parseTicketIdOnly(text: string): string | null {
  const trimmed = text.trim();
  if (!DEV_WORK_ITEM_ID_PATTERN.test(trimmed)) return null;
  return trimmed;
}

/** Leading ticket id from free-text (`PROJ-1 title…`), if present. */
export function resolveWorkItemIdFromClassifyText(text: string): string | null {
  const ticketOnly = parseTicketIdOnly(text);
  if (ticketOnly) return ticketOnly;
  return parseLeadingTicketAndTitle(text)?.id ?? null;
}

/**
 * Create `.tasks/<ID>.json` when classify preflight allows it.
 * Idempotent when the work item already exists or rehydrate succeeds.
 */
export function attemptClassifyBootstrap(input: ClassifyBootstrapInput): {
  bootstrapNotice?: string;
} {
  const intent = input.ticketOnly ? intentForTicketOnlyBootstrap(input.intent) : input.intent;

  if (!input.ticketOnly && intent.needs_confirmation) {
    return {
      bootstrapNotice: `Ticket-shaped input \`${input.id}\` detected; automatic bootstrap skipped because needs_confirmation is true.`,
    };
  }

  const patternVariant = input.ticketOnly
    ? { pattern: "implement" as const, variant: "standard" as const }
    : resolveBootstrapPatternVariant(intent, input.text);

  if (!patternVariant) {
    return {
      bootstrapNotice: `Ticket \`${input.id}\` detected; intent_mode \`${intent.intent_mode}\` does not auto-bootstrap.`,
    };
  }

  const existing = loadWorkItem(input.id);
  if (existing) {
    return {
      bootstrapNotice: `Work item \`${input.id}\` already exists (phase: ${existing.phase}) — skipping bootstrap.`,
    };
  }

  if (patternVariant.pattern === "implement") {
    const rehydrated = ensureWorkItemHydrated(input.id);
    if (rehydrated.ok && rehydrated.value.rehydrated) {
      return {
        bootstrapNotice: `${rehydrated.value.message} Run \`/dev resume ${input.id}\` to continue.`,
      };
    }
  }

  const intentContract: IntentContractInput = {
    intent_mode: intent.intent_mode,
    intent_confidence: intent.confidence,
    escalation_ceiling: intent.escalation_ceiling,
    target_paths: intent.target_paths.length ? intent.target_paths : undefined,
    out_of_scope: intent.out_of_scope.length ? intent.out_of_scope : undefined,
    expected_finish: input.ticketOnly
      ? `Deliver ${input.id} per tracker ticket (phase-gather will load ticket details).`
      : input.title.slice(0, 240),
  };

  const { pattern, variant } = patternVariant;
  const boot = devBootstrap(input.id, input.title, pattern, variant, intentContract);
  const gatherNote = input.ticketOnly
    ? " Orchestration will run gather/align via /dev resume."
    : "";
  return {
    bootstrapNotice: `Created work item \`${boot.work_item.id}\` (${pattern}${variant ? `/${variant}` : ""}) at ${boot.path}.${gatherNote}`,
  };
}

/**
 * Runs deterministic intent classification and optional `dev_bootstrap` for a
 * single-line ticket bootstrap. Always safe to call before orchestration resume.
 */
export function classifyPreflight(text: string): ClassifyPreflightResult {
  const intent = recommendIntentMode(text);
  const intentBlock = `Deterministic intent (same rules as \`dev_intent\`):\n${formatIntentRecommendation(intent)}`;

  const ticketOnlyId = parseTicketIdOnly(text);
  if (ticketOnlyId) {
    const { bootstrapNotice } = attemptClassifyBootstrap({
      id: ticketOnlyId,
      title: ticketOnlyId,
      text,
      intent,
      ticketOnly: true,
    });
    return {
      intent: intentForTicketOnlyBootstrap(intent),
      intentBlock,
      bootstrapNotice,
    };
  }

  const parsed = parseLeadingTicketAndTitle(text);
  if (!parsed) {
    return { intent, intentBlock };
  }

  const { bootstrapNotice } = attemptClassifyBootstrap({
    id: parsed.id,
    title: parsed.title,
    text,
    intent,
    ticketOnly: false,
  });

  return { intent, intentBlock, bootstrapNotice };
}
