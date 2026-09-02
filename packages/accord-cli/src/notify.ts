/**
 * stderr notifications for headless CLI (replaces Pi ctx.ui.notify).
 */

import type { OrchestrationNotifyLevel } from "@clive.shirley/accord-core/orchestration/host.js";

const PREFIX: Record<OrchestrationNotifyLevel, string> = {
  info: "info",
  warning: "warn",
  error: "error",
};

export function cliNotify(level: OrchestrationNotifyLevel, text: string): void {
  const tag = PREFIX[level];
  for (const line of text.split("\n")) {
    console.error(`[accord:${tag}] ${line}`);
  }
}
