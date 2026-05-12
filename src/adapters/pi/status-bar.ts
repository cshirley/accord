import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { discoverWorkItems } from "../../core/telemetry/usage.js";
import type { HookState } from "./hook-state.js";

export function updateStatusBar(ctx: ExtensionContext, state: HookState): void {
  const items = discoverWorkItems();
  if (items.length === 0) {
    ctx.ui.setStatus("accord", undefined);
    return;
  }

  const totalPending = items.reduce((sum, wi) => sum + wi.decisions_pending, 0);
  const totalCost = items.reduce((sum, wi) => sum + wi.cost_usd, 0);
  const theme = ctx.ui.theme;
  const parts: string[] = [];

  if (state.devConfig) parts.push(theme.fg("dim", state.devConfig.language));
  if (state.activeWorkItem) {
    const wi = items.find((i) => i.id === state.activeWorkItem);
    if (wi) {
      parts.push(theme.fg("accent", wi.id));
      parts.push(theme.fg("dim", wi.phase));
    }
  }
  if (totalPending > 0) parts.push(theme.fg("warning", `${totalPending}⚡`));
  if (totalCost > 0) parts.push(theme.fg("dim", `$${totalCost.toFixed(2)}`));
  if (parts.length > 0) ctx.ui.setStatus("accord", parts.join(" · "));
}
