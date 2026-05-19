/**
 * Deterministic handling for `/dev` free-text (classify) before the accord skill runs.
 *
 * Mirrors the first steps of `assets/skills/accord/SKILL.md` § classify: `dev_intent`
 * rules, then optional `dev_bootstrap` when the line is unambiguous (ticket + title,
 * high-confidence intent, work item missing).
 */

import { loadWorkItem } from "../work-items/io.js";
import { devBootstrap, type IntentContractInput } from "../work-items/lifecycle.js";
import { ensureWorkItemHydrated } from "../work-items/rehydrate.js";
import type { WorkItemPattern } from "../work-items/types.js";
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

function parseLeadingTicketAndTitle(text: string): { id: string; title: string } | null {
  const trimmed = text.trim();
  const match = LEADING_TICKET_TITLE.exec(trimmed);
  if (!match) return null;
  const id = match[1];
  const title = match[2].trim();
  if (title.length < MIN_TITLE_LEN) return null;
  return { id, title };
}

/**
 * Runs deterministic intent classification and optional `dev_bootstrap` for a
 * single-line ticket bootstrap. Always safe to call before forwarding to the skill.
 */
export function classifyPreflight(text: string): ClassifyPreflightResult {
  const intent = recommendIntentMode(text);
  const intentBlock = `Deterministic intent (same rules as \`dev_intent\`):\n${formatIntentRecommendation(intent)}`;

  let bootstrapNotice: string | undefined;
  const parsed = parseLeadingTicketAndTitle(text);

  if (!parsed) {
    return { intent, intentBlock, bootstrapNotice };
  }

  if (intent.needs_confirmation) {
    bootstrapNotice = `Ticket-shaped input \`${parsed.id}\` detected; automatic bootstrap skipped because needs_confirmation is true — the accord skill will continue.`;
    return { intent, intentBlock, bootstrapNotice };
  }

  const patternVariant = resolveBootstrapPatternVariant(intent, text);
  if (!patternVariant) {
    bootstrapNotice = `Ticket \`${parsed.id}\` detected; intent_mode \`${intent.intent_mode}\` does not auto-bootstrap — the accord skill will continue.`;
    return { intent, intentBlock, bootstrapNotice };
  }

  const existing = loadWorkItem(parsed.id);
  if (existing) {
    bootstrapNotice = `Work item \`${parsed.id}\` already exists (phase: ${existing.phase}) — skipping bootstrap.`;
    return { intent, intentBlock, bootstrapNotice };
  }

  if (patternVariant.pattern === "implement") {
    const rehydrated = ensureWorkItemHydrated(parsed.id);
    if (rehydrated.ok && rehydrated.value.rehydrated) {
      bootstrapNotice = `${rehydrated.value.message} The accord skill will pick up from persisted state.`;
      return { intent, intentBlock, bootstrapNotice };
    }
  }

  const intentContract: IntentContractInput = {
    intent_mode: intent.intent_mode,
    intent_confidence: intent.confidence,
    escalation_ceiling: intent.escalation_ceiling,
    target_paths: intent.target_paths.length ? intent.target_paths : undefined,
    out_of_scope: intent.out_of_scope.length ? intent.out_of_scope : undefined,
    expected_finish: parsed.title.slice(0, 240),
  };

  const { pattern, variant } = patternVariant;
  const boot = devBootstrap(parsed.id, parsed.title, pattern, variant, intentContract);
  bootstrapNotice = `Created work item \`${boot.work_item.id}\` (${pattern}${variant ? `/${variant}` : ""}) at ${boot.path}. The accord skill will pick up from persisted state.`;

  return { intent, intentBlock, bootstrapNotice };
}
