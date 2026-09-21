/**
 * High-contrast `/dev` readout blocks in Pi chat (`customMessageBg` / `toolOutput`).
 * Replaces dim `ctx.ui.notify` for multi-line harness summaries.
 */

import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { Box, Container, Spacer, Text } from "@earendil-works/pi-tui";
import { NOTIFY_SLICE } from "./notify.js";
import { styleTasksDashboardLine } from "./tasks-dashboard-display.js";

export const DEV_FORMATTED_MESSAGE_TYPE = "dev-formatted-output";

/** @deprecated Use {@link DEV_FORMATTED_MESSAGE_TYPE}. */
export const DEV_TASKS_MESSAGE_TYPE = DEV_FORMATTED_MESSAGE_TYPE;

export type DevFormattedVariant = "tasks" | "query";

export type DevFormattedMessageDetails = {
  label: string;
  formatted: string;
  variant: DevFormattedVariant;
};

const INDENT = "  ";

export type DevQueryLineKind =
  | "empty"
  | "title"
  | "section"
  | "kv"
  | "item"
  | "attention"
  | "muted"
  | "hint"
  | "success"
  | "body";

/** Classify lines from gaps, deviations, spec-gaps, review queue, retro output. */
export function classifyDevQueryLine(line: string): DevQueryLineKind {
  const trimmed = line.trimEnd();
  if (trimmed.length === 0) return "empty";
  if (trimmed === "ACCORD Retrospective") return "title";
  if (/ — (verification gaps|deviations|spec-gaps)$/.test(trimmed)) return "title";
  if (trimmed.startsWith("Review queue")) return "title";
  if (
    trimmed === "Outcomes:" ||
    trimmed === "Friction:" ||
    trimmed === "Shift-left opportunities:" ||
    trimmed === "Representative sessions:"
  ) {
    return "section";
  }
  if (/^[a-z_]+:\s/.test(trimmed)) return "kv";
  if (/^\d+ (gap|pending decision|deviation|pending)/.test(trimmed)) return "attention";
  if (
    trimmed === "Gaps:" ||
    trimmed === "Actions:" ||
    trimmed.startsWith("Verdict:") ||
    trimmed.startsWith("Verify:") ||
    trimmed.startsWith("Markdown:") ||
    /^\s*pass=/.test(trimmed)
  ) {
    return "kv";
  }
  if (trimmed.startsWith("No ") || trimmed.startsWith("All deviations")) return "muted";
  if (trimmed.includes("/dev")) return "hint";
  if (trimmed.startsWith("✓") || trimmed.startsWith("✗") || trimmed.startsWith("⚠")) {
    return "item";
  }
  if (trimmed.startsWith("- ")) return "item";
  if (/^ {2}(AC-|task-|\[|ask:|friction:|shift_left:)/.test(line) || /^ {2}→/.test(line)) {
    return "item";
  }
  if (trimmed.startsWith("Accepted") || trimmed.startsWith("Recorded plan")) return "success";
  if (trimmed.startsWith("Spawning ")) return "hint";
  return "body";
}

export function styleDevQueryLine(theme: Theme, line: string): string {
  const trimmed = line.trimEnd();
  const kind = classifyDevQueryLine(line);
  if (kind === "empty") return "";

  switch (kind) {
    case "title":
      return theme.bold(theme.fg("text", trimmed));
    case "attention":
      return theme.bold(theme.fg("warning", trimmed));
    case "section":
      return theme.bold(theme.fg("accent", trimmed));
    case "kv":
      return theme.fg("toolTitle", trimmed);
    case "item":
      return theme.fg("toolOutput", trimmed);
    case "muted":
      return theme.fg("muted", trimmed);
    case "hint":
      return theme.fg(
        "accent",
        trimmed.startsWith(INDENT) ? trimmed.slice(INDENT.length) : trimmed,
      );
    case "success":
      return theme.fg("success", trimmed);
    case "body":
      return theme.fg("text", trimmed);
    default:
      return theme.fg("text", trimmed);
  }
}

function truncateFormatted(formatted: string): string {
  if (formatted.length <= NOTIFY_SLICE) return formatted;
  return `${formatted.slice(0, NOTIFY_SLICE)}\n…(truncated)`;
}

function styleLine(theme: Theme, line: string, variant: DevFormattedVariant): string {
  if (variant === "tasks") return styleTasksDashboardLine(theme, line);
  return styleDevQueryLine(theme, line);
}

function buildDevFormattedComponent(
  formatted: string,
  label: string,
  variant: DevFormattedVariant,
  theme: Theme,
): Container {
  const container = new Container();
  container.addChild(new Spacer(1));

  const labelBox = new Box(0, 0, (t) => theme.bg("customMessageBg", t));
  labelBox.addChild(new Text(theme.bold(theme.fg("customMessageLabel", label)), 0, 0));
  container.addChild(labelBox);

  const bodyBox = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
  for (const line of formatted.split("\n")) {
    if (line.trimEnd().length === 0) {
      bodyBox.addChild(new Spacer(1));
      continue;
    }
    const styled = styleLine(theme, line, variant);
    if (styled) {
      bodyBox.addChild(new Text(styled, 0, 0));
    }
  }
  container.addChild(bodyBox);
  container.addChild(new Spacer(1));
  return container;
}

export function registerDevFormattedDisplay(pi: ExtensionAPI): void {
  pi.registerMessageRenderer(DEV_FORMATTED_MESSAGE_TYPE, (message, _options, theme) => {
    const details = message.details as DevFormattedMessageDetails | undefined;
    const formatted =
      typeof details?.formatted === "string" ? details.formatted : String(message.content ?? "");
    const label = typeof details?.label === "string" ? details.label : "[dev]";
    const variant: DevFormattedVariant = details?.variant === "tasks" ? "tasks" : "query";
    return buildDevFormattedComponent(truncateFormatted(formatted), label, variant, theme);
  });
}

/** Post a styled block in the session transcript (not dim status notify). */
export function displayDevFormatted(
  pi: ExtensionAPI,
  ctx: Pick<ExtensionCommandContext, "hasUI">,
  options: { label: string; formatted: string; variant: DevFormattedVariant },
): void {
  if (!ctx.hasUI) return;
  const body = truncateFormatted(options.formatted);
  pi.sendMessage({
    customType: DEV_FORMATTED_MESSAGE_TYPE,
    content: body.split("\n")[0] ?? options.label,
    display: true,
    details: {
      label: options.label,
      formatted: body,
      variant: options.variant,
    } satisfies DevFormattedMessageDetails,
  });
}

export function displayDevQueryOutput(
  pi: ExtensionAPI,
  ctx: Pick<ExtensionCommandContext, "hasUI">,
  subcommand: string,
  formatted: string,
): void {
  displayDevFormatted(pi, ctx, {
    label: `[dev ${subcommand}]`,
    formatted,
    variant: "query",
  });
}

export function registerTasksDashboardRenderer(pi: ExtensionAPI): void {
  registerDevFormattedDisplay(pi);
}

export function displayTasksDashboard(
  pi: ExtensionAPI,
  ctx: Pick<ExtensionCommandContext, "hasUI">,
  formatted: string,
): void {
  displayDevFormatted(pi, ctx, {
    label: "[dev tasks]",
    formatted,
    variant: "tasks",
  });
}
