/**
 * Pi TUI notification helpers.
 */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export const NOTIFY_SLICE = 3500;

export function notifyTruncated(
  ctx: ExtensionCommandContext,
  body: string,
  level: "info" | "warning",
): void {
  ctx.ui.notify(
    body.length > NOTIFY_SLICE ? `${body.slice(0, NOTIFY_SLICE)}\n…(truncated)` : body,
    level,
  );
}
