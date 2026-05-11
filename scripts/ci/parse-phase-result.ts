/**
 * AC-4 / AC-7 / AC-10: terminal-action mapping + cost-cap pre-check.
 *
 *   - `dispatchTerminal(packet, opts)` maps every phase return-packet status to
 *     the Jira-comment + transition + artifact-upload triple required by
 *     AC-4 / AC-10 / done-path-to-PR.
 *   - `checkCostCap(workItem, opts)` is the AC-7 between-phases pre-check.
 *
 * Defence-in-depth for AC-8: the comment renderer scans its rendered body
 * for any value in `opts.secrets` and refuses to emit (returning kind
 * `scrubbed`) if a match is found. The caller is expected to log and
 * route to a generic transition without leaking the body.
 */

export interface PhaseTransitions {
  readonly needs_input: string;
  readonly blocked: string;
  readonly gaps: string;
  readonly stuck: string;
  readonly cost_exceeded: string;
  readonly in_review: string;
}

export interface TerminalOpts {
  readonly ticket: string;
  readonly secrets: readonly string[];
  readonly transitions: PhaseTransitions;
}

export interface TerminalAction {
  readonly kind: "comment" | "scrubbed";
  readonly body: string;
  readonly transition: string;
  readonly uploadStateArtifact: boolean;
  readonly exitCode: number;
  readonly createsFollowUpTicket?: false;
}

interface QuestionLike {
  id: string;
  topic: string;
  text: string;
}

interface BlockerLike {
  reason: string;
  [key: string]: unknown;
}

interface GapLike {
  ac_id: string;
  reason: string;
}

interface PhaseReturnPacketUnknown {
  status: string;
  [key: string]: unknown;
}

function renderQuestions(qs: readonly QuestionLike[]): string {
  return qs.map((q) => `- **[${q.id}] ${q.topic}** — ${q.text}`).join("\n");
}

function renderBlockers(bs: readonly BlockerLike[]): string {
  return bs.map((b) => `- ${b.reason}`).join("\n");
}

function renderGaps(gs: readonly GapLike[]): string {
  return gs.map((g) => `- **${g.ac_id}** — ${g.reason}`).join("\n");
}

function scrub(body: string, secrets: readonly string[]): TerminalAction | null {
  for (const s of secrets) {
    if (s.length > 0 && body.includes(s)) {
      return {
        kind: "scrubbed",
        body: "[redacted — phase return packet contained a configured secret value; raw body suppressed]",
        transition: "Needs Triage",
        uploadStateArtifact: true,
        exitCode: 0,
      };
    }
  }
  return null;
}

export function dispatchTerminal(packet: PhaseReturnPacketUnknown, opts: TerminalOpts): TerminalAction {
  let body = "";
  let transition: string;

  switch (packet.status) {
    case "needs_input": {
      const questions = (packet.questions as QuestionLike[] | undefined) ?? [];
      body = [
        `**ACCORD autopipeline:** \`${opts.ticket}\` needs author input.`,
        "",
        renderQuestions(questions),
      ].join("\n");
      transition = opts.transitions.needs_input;
      break;
    }
    case "blocked": {
      const blockers = (packet.blockers as BlockerLike[] | undefined) ?? [];
      body = [
        `**ACCORD autopipeline:** \`${opts.ticket}\` is blocked.`,
        "",
        renderBlockers(blockers),
      ].join("\n");
      transition = opts.transitions.blocked;
      break;
    }
    case "gaps": {
      const gaps = (packet.gaps as GapLike[] | undefined) ?? [];
      body = [
        `**ACCORD autopipeline:** \`${opts.ticket}\` verify found AC gaps.`,
        "",
        renderGaps(gaps),
      ].join("\n");
      transition = opts.transitions.gaps;
      break;
    }
    case "stuck": {
      const reason = (packet.reason as string | undefined) ?? "unknown";
      const detail = (packet.detail as string | undefined) ?? "";
      body = [
        `**ACCORD autopipeline:** \`${opts.ticket}\` got stuck.`,
        "",
        `- Reason: \`${reason}\``,
        detail ? `- Detail: ${detail}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      transition = opts.transitions.stuck;
      break;
    }
    case "done": {
      body = `**ACCORD autopipeline:** \`${opts.ticket}\` complete — opening PR.`;
      transition = opts.transitions.in_review;
      break;
    }
    default: {
      body = `**ACCORD autopipeline:** \`${opts.ticket}\` returned unknown status \`${packet.status}\`.`;
      transition = opts.transitions.stuck;
    }
  }

  const scrubbed = scrub(body, opts.secrets);
  if (scrubbed) return scrubbed;

  return {
    kind: "comment",
    body,
    transition,
    uploadStateArtifact: true,
    exitCode: 0,
    createsFollowUpTicket: false,
  };
}

// ─── Cost-cap (AC-7) ───────────────────────────────────────────────

export interface WorkItemForCostCap {
  readonly id: string;
  readonly cost_usd: number;
  readonly cost_breakdown: Readonly<Record<string, number>>;
}

export interface CostCapOpts {
  readonly maxCostUsd: number;
  readonly nextPhase: string;
  readonly ticket: string;
  readonly transitionOnCostExceeded: string;
}

export type CostCapResult =
  | { readonly tripped: false }
  | { readonly tripped: true; readonly terminal: TerminalAction };

function renderCostBreakdown(breakdown: Readonly<Record<string, number>>, total: number, max: number, next: string): string {
  const entries = Object.entries(breakdown);
  const lines: string[] = [];
  lines.push(`**ACCORD autopipeline:** cost cap reached for \`${next}\` (would-have-been-next phase).`);
  lines.push("");
  if (entries.length > 0) {
    lines.push("Per-phase cost breakdown (USD):");
    for (const [phase, cost] of entries) {
      lines.push(`- ${phase}: ${cost}`);
    }
  }
  lines.push("");
  lines.push(`- Cumulative: ${total}`);
  lines.push(`- Cap: ${max}`);
  lines.push(`- Next phase that would have run: \`${next}\``);
  return lines.join("\n");
}

export function checkCostCap(wi: WorkItemForCostCap, opts: CostCapOpts): CostCapResult {
  if (wi.cost_usd < opts.maxCostUsd) {
    return { tripped: false };
  }
  const body = renderCostBreakdown(wi.cost_breakdown, wi.cost_usd, opts.maxCostUsd, opts.nextPhase);
  return {
    tripped: true,
    terminal: {
      kind: "comment",
      body,
      transition: opts.transitionOnCostExceeded,
      uploadStateArtifact: true,
      exitCode: 0,
    },
  };
}
