/**
 * stderr notifications for headless CLI (replaces Pi ctx.ui.notify).
 */

import type { OrchestrationNotifyLevel } from "@clive.shirley/accord-core/orchestration/host.js";
import { bold, dim, error, muted, warn } from "./ui/colors.js";

function formatNotifyLine(level: OrchestrationNotifyLevel, line: string): string {
  const tag =
    level === "error"
      ? error(bold("[accord:error]"))
      : level === "warning"
        ? warn(bold("[accord:warn]"))
        : dim(bold("[accord:info]"));
  return `${tag} ${line}`;
}

export function cliNotify(level: OrchestrationNotifyLevel, text: string): void {
  for (const line of text.split("\n")) {
    if (!line.trim()) {
      console.error("");
      continue;
    }
    console.error(formatNotifyLine(level, line));
  }
}
