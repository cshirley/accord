/**
 * Footer / working-message status for harness-orchestrated subagent spawns.
 * Supports multiple concurrent spawns (e.g. future spawn_parallel) via a shared registry.
 */

import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import type { HarnessSubagentProgress } from "./progress.js";

export const ORCHESTRATOR_SPAWN_STATUS_KEY = "accord-orch";
export const ORCHESTRATOR_SPAWN_WIDGET_KEY = "accord-orchestrator-spawn";

type ActiveOrchestratorSpawn = {
  label: string;
  agent: string;
  progress?: HarnessSubagentProgress;
};

const activeSpawns = new Map<string, ActiveOrchestratorSpawn>();

let lastSpawnWidgetTui: { requestRender: () => void } | undefined;

function formatSpawnLine(spawn: ActiveOrchestratorSpawn): string {
  const { agent, progress } = spawn;
  if (!progress) {
    return `${agent} (starting…)`;
  }
  const detail =
    progress.lastToolLine ?? progress.textPreview ?? `turn ${String(progress.turns)}`;
  return `${agent}: ${detail}`;
}

/** Lines for `ctx.ui.setWidget` (one line per active spawn). */
export function formatOrchestratorSpawnStatusLines(): string[] {
  if (activeSpawns.size === 0) {
    return [];
  }
  const header =
    activeSpawns.size === 1
      ? `Subagent (${activeSpawns.values().next().value?.label ?? "orchestration"})`
      : `Subagents (${String(activeSpawns.size)} running)`;
  return [header, ...[...activeSpawns.values()].map(formatSpawnLine)];
}

/** Single-line summary for `ctx.ui.setWorkingMessage` during command handlers. */
export function formatOrchestratorSpawnWorkingMessage(): string | undefined {
  if (activeSpawns.size === 0) {
    return undefined;
  }
  const agents = [...activeSpawns.values()].map((s) => s.agent);
  const label = activeSpawns.values().next().value?.label ?? "Orchestration";
  if (agents.length === 1) {
    const spawn = activeSpawns.values().next().value;
    const detail = spawn?.progress?.lastToolLine ?? spawn?.progress?.textPreview;
    return detail ? `${label}: ${agents[0]} — ${detail}` : `${label}: ${agents[0]}…`;
  }
  return `${label}: ${agents.join(", ")}`;
}

/** Yield so Pi can paint widget/footer updates while an extension command is awaiting a subprocess. */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function buildSpawnWidgetComponent(theme: Theme): Container {
  const lines = formatOrchestratorSpawnStatusLines();
  const container = new Container();
  if (lines.length === 0) {
    container.addChild(new Text(theme.fg("muted", "(orchestrator idle)"), 1, 0));
    return container;
  }
  for (const line of lines) {
    const styled =
      line.startsWith("Subagent") || line.startsWith("Subagents")
        ? theme.fg("accent", line)
        : theme.fg("toolOutput", line);
    container.addChild(new Text(styled, 1, 0));
  }
  return container;
}

/** Mount a widget that re-reads the spawn registry on every Pi render pass. */
export function mountOrchestratorSpawnWidget(
  ctx: Pick<ExtensionCommandContext, "hasUI" | "ui">,
): void {
  if (!ctx.hasUI) {
    return;
  }
  ctx.ui.setWidget(
    ORCHESTRATOR_SPAWN_WIDGET_KEY,
    (tui, theme) => {
      lastSpawnWidgetTui = tui;
      return buildSpawnWidgetComponent(theme);
    },
    { placement: "aboveEditor" },
  );
}

export function clearOrchestratorSpawnWidget(
  ctx: Pick<ExtensionCommandContext, "hasUI" | "ui">,
): void {
  if (!ctx.hasUI) {
    return;
  }
  ctx.ui.setWidget(ORCHESTRATOR_SPAWN_WIDGET_KEY, undefined);
  lastSpawnWidgetTui = undefined;
}

export function applyOrchestratorSpawnStatus(
  ctx: Pick<ExtensionCommandContext, "hasUI" | "ui">,
): void {
  if (!ctx.hasUI) {
    return;
  }
  const lines = formatOrchestratorSpawnStatusLines();
  if (lines.length === 0) {
    ctx.ui.setStatus(ORCHESTRATOR_SPAWN_STATUS_KEY, undefined);
    ctx.ui.setWorkingMessage(undefined);
    return;
  }
  ctx.ui.setStatus(ORCHESTRATOR_SPAWN_STATUS_KEY, lines.join(" · "));
  const working = formatOrchestratorSpawnWorkingMessage();
  if (working) {
    ctx.ui.setWorkingMessage(working);
  }
}

/** Push footer status + above-editor widget; yield so the TUI can repaint during `/dev resume`. */
export async function refreshOrchestratorSpawnUi(
  ctx: Pick<ExtensionCommandContext, "hasUI" | "ui">,
): Promise<void> {
  applyOrchestratorSpawnStatus(ctx);
  if (!ctx.hasUI) {
    return;
  }
  mountOrchestratorSpawnWidget(ctx);
  lastSpawnWidgetTui?.requestRender();
  await yieldToEventLoop();
}

export function registerOrchestratorSpawn(
  spawnId: string,
  info: { label: string; agent: string },
): void {
  activeSpawns.set(spawnId, { label: info.label, agent: info.agent });
}

export function updateOrchestratorSpawn(spawnId: string, progress: HarnessSubagentProgress): void {
  const row = activeSpawns.get(spawnId);
  if (!row) {
    return;
  }
  row.progress = progress;
}

export function unregisterOrchestratorSpawn(spawnId: string): void {
  activeSpawns.delete(spawnId);
}
