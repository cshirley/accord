/**
 * Host-neutral guardrail check. Pure: no pi, no I/O.
 * Adapters (pi extension, Claude Code hook, CI) map the verdict to their own mechanism.
 */

import { classify, type DangerMatch, type Risk } from "./patterns.js";

export type GuardrailVerdict = {
  /** Highest risk found, or "none". */
  risk: Risk | "none";
  /** allow = no match, ask = medium, deny = high. */
  action: "allow" | "ask" | "deny";
  matches: DangerMatch[];
  reason: string;
};

export function checkCommand(command: string): GuardrailVerdict {
  const matches = classify(command);
  const risk: Risk | "none" = matches.some((m) => m.risk === "high")
    ? "high"
    : matches.length > 0
      ? "medium"
      : "none";
  const action = risk === "high" ? "deny" : risk === "medium" ? "ask" : "allow";
  const reason = matches.map((m) => `${m.risk}: ${m.category} — ${m.description}`).join("; ");
  return { risk, action, matches, reason };
}

/** Exit code contract: 0 allow, 1 ask (medium), 2 deny (high). */
export function verdictExitCode(v: GuardrailVerdict): number {
  return v.action === "deny" ? 2 : v.action === "ask" ? 1 : 0;
}

const SHELL_TOOL_NAMES = new Set(["bash", "bg_process", "bg_watch", "shell", "run_shell_command"]);

/** Extract the shell command from a Claude Code / Gemini style PreToolUse payload. Null if not a shell tool. */
export function commandFromHookPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as { tool_name?: unknown; tool_input?: { command?: unknown } };
  if (typeof p.tool_name !== "string" || !SHELL_TOOL_NAMES.has(p.tool_name.toLowerCase()))
    return null;
  const cmd = p.tool_input?.command;
  return typeof cmd === "string" ? cmd : null;
}

/** Claude Code PreToolUse hook output for a verdict. Null = no opinion (allow). */
export function claudeHookOutput(v: GuardrailVerdict): Record<string, unknown> | null {
  if (v.action === "allow") return null;
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: v.action,
      permissionDecisionReason: `guardrail: ${v.reason}`,
    },
  };
}
