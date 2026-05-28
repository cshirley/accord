/**
 * High-contrast `/dev tasks` output in the Pi chat (avoids dim `showStatus` notify styling).
 */

import type { ExtensionAPI, ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { Box, Container, Spacer, Text } from "@earendil-works/pi-tui";
import { NOTIFY_SLICE } from "./notify.js";

export const DEV_TASKS_MESSAGE_TYPE = "dev-tasks-dashboard";

const INDENT = "  ";

export type TasksDashboardLineKind =
  | "title"
  | "section"
  | "header"
  | "dash"
  | "attention"
  | "muted"
  | "hint"
  | "legend"
  | "row"
  | "empty";

export type TasksDashboardMessageDetails = {
  formatted: string;
};

/** Classify a dashboard text line for themed rendering (testable without a TUI). */
export function classifyTasksDashboardLine(line: string): TasksDashboardLineKind {
  const trimmed = line.trimEnd();
  if (trimmed.length === 0) return "empty";
  if (trimmed.startsWith("Work items")) return "title";
  if (trimmed === "Active" || trimmed === "Done") return "section";
  if (trimmed.startsWith("ID")) return "header";
  if (trimmed === "—") return "dash";
  if (trimmed.startsWith("Needs attention")) return "attention";
  if (trimmed.startsWith("No items need review")) return "muted";
  if (trimmed.startsWith(INDENT) && trimmed.includes("/dev")) return "hint";
  if (trimmed.startsWith(`${INDENT}tasks:`)) return "legend";
  if (/^\s+\d+ work item/.test(line)) return "title";
  if (/^[A-Z][A-Z0-9_-]+/.test(trimmed)) return "row";
  return "title";
}

export function styleTasksDashboardLine(theme: Theme, line: string): string {
  const trimmed = line.trimEnd();
  const kind = classifyTasksDashboardLine(line);
  if (kind === "empty") return "";

  switch (kind) {
    case "title":
      return theme.bold(theme.fg("text", trimmed));
    case "section":
      return theme.bold(theme.fg("accent", trimmed));
    case "header":
      return theme.bold(theme.fg("toolTitle", trimmed));
    case "dash":
      return theme.fg("border", trimmed);
    case "attention":
      return theme.bold(theme.fg("warning", trimmed));
    case "muted":
      return theme.fg("muted", trimmed);
    case "hint":
      return theme.fg("accent", trimmed.slice(INDENT.length));
    case "legend":
      return theme.fg("dim", trimmed);
    case "row":
      return theme.fg("toolOutput", trimmed);
    default:
      return theme.fg("text", trimmed);
  }
}

function truncateFormatted(formatted: string): string {
  if (formatted.length <= NOTIFY_SLICE) return formatted;
  return `${formatted.slice(0, NOTIFY_SLICE)}\n…(truncated)`;
}

function buildTasksDashboardComponent(formatted: string, theme: Theme): Container {
  const container = new Container();
  container.addChild(new Spacer(1));

  const labelBox = new Box(0, 0, (t) => theme.bg("customMessageBg", t));
  labelBox.addChild(new Text(theme.bold(theme.fg("customMessageLabel", "[dev tasks]")), 0, 0));
  container.addChild(labelBox);

  const bodyBox = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
  for (const line of formatted.split("\n")) {
    if (line.trimEnd().length === 0) {
      bodyBox.addChild(new Spacer(1));
      continue;
    }
    const styled = styleTasksDashboardLine(theme, line);
    if (styled) {
      bodyBox.addChild(new Text(styled, 0, 0));
    }
  }
  container.addChild(bodyBox);
  container.addChild(new Spacer(1));
  return container;
}

export function registerTasksDashboardRenderer(pi: ExtensionAPI): void {
  pi.registerMessageRenderer(DEV_TASKS_MESSAGE_TYPE, (message, _options, theme) => {
    const details = message.details as TasksDashboardMessageDetails | undefined;
    const formatted =
      typeof details?.formatted === "string" ? details.formatted : String(message.content ?? "");
    return buildTasksDashboardComponent(truncateFormatted(formatted), theme);
  });
}

/** Post a styled dashboard block in the session transcript (`toolOutput` / `text`, not dim status). */
export function displayTasksDashboard(
  pi: ExtensionAPI,
  ctx: Pick<ExtensionCommandContext, "hasUI">,
  formatted: string,
): void {
  if (!ctx.hasUI) return;
  const body = truncateFormatted(formatted);
  pi.sendMessage({
    customType: DEV_TASKS_MESSAGE_TYPE,
    content: body.split("\n")[0] ?? "Work items",
    display: true,
    details: { formatted: body } satisfies TasksDashboardMessageDetails,
  });
}
