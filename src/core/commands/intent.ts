/**
 * Intent recommendation for /dev free-text requests.
 *
 * This is deliberately deterministic: it gives the orchestrator a stable
 * starting point and an escalation ceiling before any phase agent can turn a
 * narrow ask into a full pipeline.
 */

export type IntentMode =
  | "narrow_change"
  | "pipeline"
  | "review"
  | "commit"
  | "explain"
  | "investigate";

export type IntentConfidence = "high" | "medium" | "low";

export type EscalationCeiling =
  | "pipeline_allowed"
  | "no_pipeline_without_confirmation"
  | "no_implementation_without_confirmation"
  | "read_only_until_confirmed"
  | "no_edits";

export interface IntentRecommendation {
  intent_mode: IntentMode;
  confidence: IntentConfidence;
  reasons: string[];
  needs_confirmation: boolean;
  escalation_ceiling: EscalationCeiling;
  target_paths: string[];
  out_of_scope: string[];
  recommended_pattern?: "implement" | "quick_fix" | "investigate" | "infra" | "analyse";
  recommended_variant?: "express" | "standard" | "orchestrated";
}

const MODE_ORDER: IntentMode[] = [
  "commit",
  "review",
  "pipeline",
  "narrow_change",
  "investigate",
  "explain",
];

function uniq(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)));
}

function has(re: RegExp, text: string): boolean {
  return re.test(text);
}

function extractTargetPaths(text: string): string[] {
  const paths: string[] = [];
  const atRefs = text.match(/@[\w./~-]+/g) || [];
  for (const ref of atRefs) paths.push(ref.slice(1));

  const pathish = text.match(/(?:^|\s)([\w.~/-]+\/[\w.~/-]+)(?=\s|$|[,.):;])/g) || [];
  for (const raw of pathish) paths.push(raw.trim());

  return uniq(paths);
}

function scoreMode(text: string, targetPaths: string[]): Record<IntentMode, number> {
  const score: Record<IntentMode, number> = {
    narrow_change: 0,
    pipeline: 0,
    review: 0,
    commit: 0,
    explain: 0,
    investigate: 0,
  };

  if (has(/\b(commit|stage|save (?:my |the )?work|create a commit|commit message)\b/i, text)) score.commit += 5;
  if (has(/\b(review|code review|pre-commit sanity|find risks|find issues|critique)\b/i, text)) score.review += 5;

  const hasTicket = has(/[A-Z]+(?:-[A-Z]+)*-\d+/, text);
  if (has(/\b(implement|build|feature|ship|end-to-end|full pipeline|spec and plan)\b/i, text)) score.pipeline += 2;
  if (hasTicket) score.pipeline += 2;
  if (hasTicket && has(/\b(add|update|change|fix)\b/i, text)) score.pipeline += 1;
  if (!targetPaths.length && has(/\badd\b/i, text)) score.pipeline += 1;
  if (has(/\b(worktrees?|orchestrated|parallelisable|parallelizable)\b/i, text)) score.pipeline += 2;

  if (targetPaths.length > 0) score.narrow_change += 2;
  if (has(/\b(fix|tweak|change|update|rename|one-line|small|quick|narrow)\b/i, text)) score.narrow_change += 2;
  if (targetPaths.length > 0 && has(/\badd\b/i, text)) score.narrow_change += 2;
  if (has(/\b(do not|don't) (?:implement|change|edit|touch)\b/i, text)) score.narrow_change -= 1;

  if (has(/\b(why|root cause|debug|diagnose|investigate|failing|fails|broken|error|blocked)\b/i, text)) score.investigate += 3;
  if (has(/\b(how can i|how do i|explain|what does|what is|suggest|should i|is there a way|based on (?:the )?feedback)\b/i, text)) score.explain += 3;

  if (has(/\b(terraform|helm|kubernetes|pulumi|cloudformation|iac)\b/i, text)) score.pipeline += 1;
  if (has(/\b(adr|design doc|write up|compare options)\b/i, text)) score.explain += 1;

  return score;
}

function confidence(topScore: number, secondScore: number): IntentConfidence {
  if (topScore >= 3 && topScore - secondScore >= 2) return "high";
  if (topScore >= 3 && topScore - secondScore >= 1) return "medium";
  return "low";
}

function ceilingFor(mode: IntentMode): EscalationCeiling {
  switch (mode) {
    case "pipeline": return "pipeline_allowed";
    case "narrow_change": return "no_pipeline_without_confirmation";
    case "investigate": return "read_only_until_confirmed";
    case "review": return "no_implementation_without_confirmation";
    case "commit": return "no_edits";
    case "explain": return "no_edits";
  }
}

function recommendedPattern(mode: IntentMode): Pick<IntentRecommendation, "recommended_pattern" | "recommended_variant"> {
  switch (mode) {
    case "pipeline": return { recommended_pattern: "implement", recommended_variant: "standard" };
    case "narrow_change": return { recommended_pattern: "quick_fix" };
    case "investigate": return { recommended_pattern: "investigate" };
    case "explain": return { recommended_pattern: "analyse" };
    default: return {};
  }
}

export function recommendIntentMode(text: string, brief?: string): IntentRecommendation {
  const combined = [text, brief].filter(Boolean).join("\n\n");
  const targetPaths = extractTargetPaths(combined);
  const scores = scoreMode(combined, targetPaths);
  const ranked = [...MODE_ORDER].sort((a, b) => scores[b] - scores[a]);
  const mode = ranked[0];
  const conf = confidence(scores[mode], scores[ranked[1]]);
  const reasons: string[] = [];

  if (targetPaths.length > 0) reasons.push(`mentions target path(s): ${targetPaths.join(", ")}`);
  if (mode === "pipeline") reasons.push("contains broad implementation or ticket cues");
  if (mode === "narrow_change") reasons.push("looks like a bounded edit rather than a full harness run");
  if (mode === "investigate") reasons.push("asks for diagnosis/root cause before edits");
  if (mode === "explain") reasons.push("asks for explanation or recommendations");
  if (mode === "review") reasons.push("asks for review/findings");
  if (mode === "commit") reasons.push("asks for staging/commit workflow");
  if (conf === "low") reasons.push("signals are weak or conflicting");

  return {
    intent_mode: mode,
    confidence: conf,
    reasons,
    needs_confirmation: conf !== "high" || (mode === "pipeline" && !has(/\b(full pipeline|spec|plan|implement)\b/i, combined)),
    escalation_ceiling: ceilingFor(mode),
    target_paths: targetPaths,
    out_of_scope: mode === "narrow_change" ? ["full pipeline", "unrelated refactors"] : [],
    ...recommendedPattern(mode),
  };
}

// ── Ticket-based enrichment ─────────────────────────────

const UPGRADE_THRESHOLD = 4;
const DOWNGRADE_THRESHOLD = 4;
const CONFIDENCE_BOOST_THRESHOLD = 3;

const AC_HIGH_WEIGHT = 3;
const AC_LOW_WEIGHT = 2;
const SP_HIGH_WEIGHT = 2;
const SP_LOW_WEIGHT = 2;
const SUBTASK_HIGH_WEIGHT = 2;
const SUBTASK_LOW_WEIGHT = 1;
const DESC_HIGH_WEIGHT = 1;
const DESC_LOW_WEIGHT = 1;
const EPIC_WEIGHT = 3;
const STORY_WEIGHT = 1;
const BUG_LOW_AC_WEIGHT = 1;
const LINKED_ISSUE_WEIGHT = 1;

const REFINABLE_MODES: ReadonlySet<IntentMode> = new Set(["narrow_change", "pipeline"]);

export interface TicketSignals {
  issue_type?: string;
  story_points?: number;
  ac_count?: number;
  description_length?: number;
  subtask_count?: number;
  linked_issue_count?: number;
}

export interface RefinementResult {
  original: Pick<IntentRecommendation, "intent_mode" | "confidence" | "recommended_pattern" | "recommended_variant">;
  refined: IntentRecommendation;
  changed: boolean;
  refinement_reasons: string[];
}

function countSignalWeight(signals: TicketSignals): { upgradeWeight: number; downgradeWeight: number } {
  let upgradeWeight = 0;
  let downgradeWeight = 0;

  if (signals.ac_count !== undefined) {
    if (signals.ac_count >= 3) upgradeWeight += AC_HIGH_WEIGHT;
    else if (signals.ac_count <= 1) downgradeWeight += AC_LOW_WEIGHT;
  }

  if (signals.story_points !== undefined) {
    if (signals.story_points >= 3) upgradeWeight += SP_HIGH_WEIGHT;
    else if (signals.story_points <= 1) downgradeWeight += SP_LOW_WEIGHT;
  }

  if (signals.subtask_count !== undefined) {
    if (signals.subtask_count >= 2) upgradeWeight += SUBTASK_HIGH_WEIGHT;
    else if (signals.subtask_count === 0) downgradeWeight += SUBTASK_LOW_WEIGHT;
  }

  if (signals.description_length !== undefined) {
    if (signals.description_length > 500) upgradeWeight += DESC_HIGH_WEIGHT;
    else if (signals.description_length < 200) downgradeWeight += DESC_LOW_WEIGHT;
  }

  if (signals.issue_type) {
    const t = signals.issue_type.toLowerCase();
    if (t === "epic") upgradeWeight += EPIC_WEIGHT;
    else if (t === "story" || t === "feature") upgradeWeight += STORY_WEIGHT;
    else if (t === "bug" && (signals.ac_count ?? 0) <= 1) downgradeWeight += BUG_LOW_AC_WEIGHT;
  }

  if (signals.linked_issue_count !== undefined && signals.linked_issue_count >= 3) {
    upgradeWeight += LINKED_ISSUE_WEIGHT;
  }

  return { upgradeWeight, downgradeWeight };
}

export function refineWithTicketSignals(
  base: IntentRecommendation,
  signals: TicketSignals,
): RefinementResult {
  const original = {
    intent_mode: base.intent_mode,
    confidence: base.confidence,
    recommended_pattern: base.recommended_pattern,
    recommended_variant: base.recommended_variant,
  };

  if (!REFINABLE_MODES.has(base.intent_mode)) {
    return { original, refined: base, changed: false, refinement_reasons: [] };
  }

  const refined: IntentRecommendation = {
    ...base,
    reasons: [...base.reasons],
    target_paths: [...base.target_paths],
    out_of_scope: [...base.out_of_scope],
  };
  const refinement_reasons: string[] = [];
  const { upgradeWeight, downgradeWeight } = countSignalWeight(signals);

  const shouldUpgrade =
    base.intent_mode === "narrow_change" && upgradeWeight >= UPGRADE_THRESHOLD && upgradeWeight > downgradeWeight;
  const shouldDowngrade =
    base.intent_mode === "pipeline" && downgradeWeight >= DOWNGRADE_THRESHOLD && downgradeWeight > upgradeWeight;

  if (shouldUpgrade) {
    refined.intent_mode = "pipeline";
    refined.recommended_pattern = "implement";
    refined.recommended_variant = "standard";
    refined.escalation_ceiling = "pipeline_allowed";
    refined.needs_confirmation = true;
    refinement_reasons.push(
      `ticket signals suggest full pipeline (ac_count=${signals.ac_count ?? "?"}, ` +
      `story_points=${signals.story_points ?? "?"}, subtasks=${signals.subtask_count ?? "?"})`,
    );
    refined.reasons.push("upgraded from narrow_change: ticket scope exceeds quick_fix threshold");
  } else if (shouldDowngrade) {
    refined.intent_mode = "narrow_change";
    refined.recommended_pattern = "quick_fix";
    delete refined.recommended_variant;
    refined.escalation_ceiling = "no_pipeline_without_confirmation";
    refined.needs_confirmation = true;
    refinement_reasons.push(
      `ticket signals suggest quick_fix (ac_count=${signals.ac_count ?? "?"}, ` +
      `story_points=${signals.story_points ?? "?"}, description_length=${signals.description_length ?? "?"})`,
    );
    refined.reasons.push("downgraded from pipeline: ticket scope fits quick_fix");
  }

  if (!shouldUpgrade && !shouldDowngrade && base.confidence !== "high") {
    if (upgradeWeight >= CONFIDENCE_BOOST_THRESHOLD && base.intent_mode === "pipeline") {
      refined.confidence = "high";
      refinement_reasons.push("ticket signals confirm pipeline scope");
      refined.reasons.push("confidence boosted by ticket signals");
    } else if (downgradeWeight >= CONFIDENCE_BOOST_THRESHOLD && base.intent_mode === "narrow_change") {
      refined.confidence = "high";
      refinement_reasons.push("ticket signals confirm narrow scope");
      refined.reasons.push("confidence boosted by ticket signals");
    }
    if (refined.confidence === "high") {
      refined.needs_confirmation = false;
    }
  }

  return {
    original,
    refined,
    changed: shouldUpgrade || shouldDowngrade || refined.confidence !== base.confidence,
    refinement_reasons,
  };
}

export function formatRefinementResult(r: RefinementResult): string {
  if (!r.changed) return "Ticket signals did not change the recommendation.";
  const lines = [
    `intent_mode: ${r.original.intent_mode} → ${r.refined.intent_mode}`,
    `confidence: ${r.original.confidence} → ${r.refined.confidence}`,
    `needs_confirmation: ${r.refined.needs_confirmation}`,
    `escalation_ceiling: ${r.refined.escalation_ceiling}`,
  ];
  if (r.refined.recommended_pattern) {
    lines.push(`recommended_pattern: ${r.refined.recommended_pattern}${r.refined.recommended_variant ? `/${r.refined.recommended_variant}` : ""}`);
  }
  if (r.refinement_reasons.length) {
    lines.push("refinement_reasons:");
    for (const reason of r.refinement_reasons) lines.push(`- ${reason}`);
  }
  return lines.join("\n");
}

// ── Formatting ──────────────────────────────────────────

export function formatIntentRecommendation(r: IntentRecommendation): string {
  const lines = [
    `intent_mode: ${r.intent_mode}`,
    `confidence: ${r.confidence}`,
    `needs_confirmation: ${r.needs_confirmation}`,
    `escalation_ceiling: ${r.escalation_ceiling}`,
  ];
  if (r.recommended_pattern) lines.push(`recommended_pattern: ${r.recommended_pattern}${r.recommended_variant ? `/${r.recommended_variant}` : ""}`);
  if (r.target_paths.length) lines.push(`target_paths: ${r.target_paths.join(", ")}`);
  if (r.out_of_scope.length) lines.push(`out_of_scope: ${r.out_of_scope.join(", ")}`);
  if (r.reasons.length) {
    lines.push("reasons:");
    for (const reason of r.reasons) lines.push(`- ${reason}`);
  }
  return lines.join("\n");
}
