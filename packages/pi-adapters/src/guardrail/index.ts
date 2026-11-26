/**
 * guardrail — risk-classified gate for bash commands.
 *
 * Intercepts bash tool calls, classifies commands by risk level, and prompts
 * for user confirmation before execution. Supports session-persistent
 * "remember" choices per category.
 *
 * Features:
 * - 🔴 High-risk commands (rm -rf, sudo, disk ops) require explicit approval
 * - 🟡 Medium-risk commands (force push, killall, permission changes) show a prompt
 * - Per-category "allow/block for session" memory
 * - /gate command (alias /guardrail) to inspect and reset remembered choices
 * - Ctrl+Alt+G to toggle the guardrail on/off
 * - Non-interactive mode: blocks high-risk, warns on medium-risk
 * - System prompt hint nudging the LLM toward safer alternatives
 *
 * Renamed from `dangerous-command-gate`. Legacy session entry keys
 * (`dangerous-command-gate`, `dangerous-command-gate-context`) are still
 * recognised on session restore.
 */

import {
  classify,
  type DangerMatch,
  type Risk,
  riskBadge,
} from "@clive.shirley/accord-core/guardrail/index.js";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Key } from "@earendil-works/pi-tui";

// Persisted-state keys
/** Tools whose `command` input runs in a shell. */
const SHELL_TOOLS = new Set(["bash", "bg_process", "bg_watch"]);

const STATE_ENTRY = "guardrail";
const CONTEXT_TYPE = "guardrail-context";
// Legacy keys — still read for backward-compat with old sessions / running
// extension builds. Never written.
const LEGACY_STATE_ENTRY = "dangerous-command-gate";
const LEGACY_CONTEXT_TYPE = "dangerous-command-gate-context";

interface GateState {
  enabled: boolean;
  allowedCategories: string[];
  blockedCategories: string[];
}

export default function guardrail(pi: ExtensionAPI): void {
  let enabled = true;
  const allowedCategories = new Set<string>();
  const blockedCategories = new Set<string>();

  // ── Helpers ──────────────────────────────────────────────────

  function highestRisk(matches: DangerMatch[]): Risk {
    return matches.some((m) => m.risk === "high") ? "high" : "medium";
  }

  function formatMatchSummary(matches: DangerMatch[]): string {
    return matches
      .map((m) => `  ${riskBadge(m.risk)}  ${m.category} — ${m.description}`)
      .join("\n");
  }

  function updateStatus(ctx: ExtensionContext): void {
    if (!enabled) {
      ctx.ui.setStatus("guardrail", ctx.ui.theme.fg("muted", "🔓 guardrail off"));
      return;
    }
    const allowed = allowedCategories.size;
    const blocked = blockedCategories.size;
    const parts: string[] = ["🛡 guardrail"];
    if (allowed > 0) parts.push(ctx.ui.theme.fg("success", `${allowed} allowed`));
    if (blocked > 0) parts.push(ctx.ui.theme.fg("error", `${blocked} blocked`));
    ctx.ui.setStatus("guardrail", parts.join(" "));
  }

  function persistState(): void {
    pi.appendEntry(STATE_ENTRY, {
      enabled,
      allowedCategories: [...allowedCategories],
      blockedCategories: [...blockedCategories],
    } satisfies GateState);
  }

  // ── Tool call gate ───────────────────────────────────────────

  pi.on("tool_call", async (event, ctx) => {
    // bash plus background shell tools (e.g. @steveimm/pi-background bg_process/bg_watch)
    if (!enabled || !SHELL_TOOLS.has(event.toolName)) return undefined;

    const command = (event.input as { command?: unknown }).command;
    if (typeof command !== "string" || command.length === 0) return undefined;
    const matches = classify(command);
    if (matches.length === 0) return undefined;

    const risk = highestRisk(matches);
    const categories = matches.map((m) => m.category);

    // Check session memory — if ALL matched categories are remembered, apply that decision
    const allAllowed = categories.every((c) => allowedCategories.has(c));
    const anyBlocked = categories.some((c) => blockedCategories.has(c));

    if (anyBlocked) {
      return {
        block: true,
        reason: `Blocked (remembered): ${categories.filter((c) => blockedCategories.has(c)).join(", ")}`,
      };
    }
    if (allAllowed) return undefined; // all categories previously approved

    // Non-interactive fallback
    if (!ctx.hasUI) {
      if (risk === "high") {
        return {
          block: true,
          reason: `High-risk command blocked (no UI): ${categories.join(", ")}`,
        };
      }
      // Medium-risk in non-interactive: allow with logged warning
      return undefined;
    }

    // ── Interactive prompt ──────────────────────────────────────

    const header = [
      `⚠️  Risky command detected  ${riskBadge(risk)}`,
      "",
      `  $ ${command.length > 120 ? `${command.slice(0, 117)}...` : command}`,
      "",
      "Matched rules:",
      formatMatchSummary(matches),
    ].join("\n");

    const options = [
      "Allow once",
      "Allow this category for session",
      "Block",
      "Block this category for session",
    ];

    const choice = await ctx.ui.select(header, options);

    switch (choice) {
      case "Allow once":
        return undefined;

      case "Allow this category for session":
        for (const c of categories) allowedCategories.add(c);
        persistState();
        updateStatus(ctx);
        return undefined;

      case "Block":
        return { block: true, reason: `Blocked by user: ${categories.join(", ")}` };

      case "Block this category for session":
        for (const c of categories) blockedCategories.add(c);
        persistState();
        updateStatus(ctx);
        return { block: true, reason: `Blocked (remembered): ${categories.join(", ")}` };

      default:
        // Dismissed / Esc — treat as block for safety
        return { block: true, reason: "Guardrail prompt dismissed — blocked by default" };
    }
  });

  // ── System prompt guidance ───────────────────────────────────

  pi.on("before_agent_start", async (event) => {
    if (!enabled) return;
    const guardrailHint = [
      "",
      "[GUARDRAIL ACTIVE]",
      "Destructive or privileged commands will be gated for user approval.",
      "Prefer safe alternatives where possible:",
      "  - `trash` or `git clean -n` (dry-run) over `rm -rf`",
      "  - Review diffs before `git reset --hard`",
      "  - Scope permission changes narrowly rather than `chmod -R 777`",
      "Break destructive operations into smaller, reviewable steps.",
    ].join("\n");
    return {
      systemPrompt: event.systemPrompt + guardrailHint,
    };
  });

  // Strip stale guardrail context when disabled (also strips legacy key
  // so old session restores don’t leak the old prompt back in).
  pi.on("context", async (event) => {
    if (enabled) return;
    return {
      messages: event.messages.filter((m) => {
        const msg = m as typeof m & { customType?: string };
        return msg.customType !== CONTEXT_TYPE && msg.customType !== LEGACY_CONTEXT_TYPE;
      }),
    };
  });

  // ── /gate command ────────────────────────────────────────────

  function registerGuardrailCommand(name: string): void {
    pi.registerCommand(name, {
      description: "Manage the guardrail (no args = status, 'reset' | 'on' | 'off')",
      handler: async (args, ctx) => {
        const sub = args?.trim().toLowerCase();

        if (sub === "reset") {
          allowedCategories.clear();
          blockedCategories.clear();
          persistState();
          updateStatus(ctx);
          ctx.ui.notify("Guardrail memory cleared", "info");
          return;
        }

        if (sub === "on") {
          enabled = true;
          persistState();
          updateStatus(ctx);
          ctx.ui.notify("Guardrail enabled 🛡", "info");
          return;
        }

        if (sub === "off") {
          enabled = false;
          persistState();
          updateStatus(ctx);
          ctx.ui.notify("Guardrail disabled 🔓", "warning");
          return;
        }

        // Default: show status
        const lines = [
          `Guardrail: ${enabled ? "🛡 ON" : "🔓 OFF"}`,
          "",
          `Allowed categories (${allowedCategories.size}):`,
          ...(allowedCategories.size > 0
            ? [...allowedCategories].map((c) => `  ✅ ${c}`)
            : ["  (none)"]),
          "",
          `Blocked categories (${blockedCategories.size}):`,
          ...(blockedCategories.size > 0
            ? [...blockedCategories].map((c) => `  🚫 ${c}`)
            : ["  (none)"]),
        ];
        ctx.ui.notify(lines.join("\n"), "info");
      },
    });
  }

  // /guardrail and /gate (alias for muscle memory)
  registerGuardrailCommand("guardrail");
  registerGuardrailCommand("gate");

  // ── Ctrl+Alt+G shortcut ──────────────────────────────────────

  pi.registerShortcut(Key.ctrlAlt("g"), {
    description: "Toggle guardrail",
    handler: async (ctx) => {
      enabled = !enabled;
      persistState();
      updateStatus(ctx);
      ctx.ui.notify(
        enabled ? "Guardrail enabled 🛡" : "Guardrail disabled 🔓",
        enabled ? "info" : "warning",
      );
    },
  });

  // ── Session restore ──────────────────────────────────────────

  pi.on("session_start", async (_event, ctx) => {
    const entries = ctx.sessionManager.getEntries();

    // Find the last persisted guardrail state — prefer the new key, fall
    // back to the legacy key for sessions started before the rename.
    const gateEntry = entries
      .filter(
        (e: { type: string; customType?: string }) =>
          e.type === "custom" &&
          (e.customType === STATE_ENTRY || e.customType === LEGACY_STATE_ENTRY),
      )
      .pop() as { data?: GateState } | undefined;

    if (gateEntry?.data) {
      enabled = gateEntry.data.enabled ?? true;
      allowedCategories.clear();
      blockedCategories.clear();
      for (const c of gateEntry.data.allowedCategories ?? []) allowedCategories.add(c);
      for (const c of gateEntry.data.blockedCategories ?? []) blockedCategories.add(c);
    }

    updateStatus(ctx);
  });
}
