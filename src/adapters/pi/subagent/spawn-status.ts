/**
 * Footer / working-message status for harness-orchestrated subagent spawns.
 * Supports multiple concurrent spawns (e.g. future spawn_parallel) via a shared registry.
 */

import type { ExtensionCommandContext, Theme } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import type { SubagentProgress } from "../../../integrations/pi-subagent.js";
import {
  formatOrchestratorProgressWidgetLines,
  formatOrchestratorSpawnElapsed,
  formatOrchestratorStallHint,
  ORCHESTRATOR_SPAWN_HEARTBEAT_MS,
} from "./spawn-ui.js";
import { refreshOrchestratorSubagentChatDisplays } from "./chat-display.js";

export const ORCHESTRATOR_SPAWN_STATUS_KEY = "accord-orch";
export const ORCHESTRATOR_SPAWN_WIDGET_KEY = "accord-orchestrator-spawn";

export { formatOrchestratorSpawnElapsed, ORCHESTRATOR_SPAWN_HEARTBEAT_MS };

type ActiveOrchestratorSpawn = {
  label: string;
  agent: string;
  startedAt: number;
  progress?: SubagentProgress;
};

const activeSpawns = new Map<string, ActiveOrchestratorSpawn>();

let lastSpawnWidgetTui: { requestRender: () => void } | undefined;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let heartbeatCtx: Pick<ExtensionCommandContext, "hasUI" | "ui"> | undefined;

function formatSpawnLine(spawn: ActiveOrchestratorSpawn): string {
  const { agent, progress } = spawn;
  const elapsed = formatOrchestratorSpawnElapsed(spawn.startedAt);
  if (!progress) {
    return `${agent} (${elapsed} · starting…)`;
  }
  const stallHint = formatOrchestratorStallHint(progress, spawn.startedAt);
  const detail =
    progress.activityLines.at(-1) ??
    progress.lastToolLine ??
    stallHint ??
    progress.textPreview ??
    `turn ${String(progress.turns)}`;
  return `${agent}: ${elapsed} · ${detail}`;
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
    if (!spawn) {
      return `${label}: ${agents[0]}…`;
    }
    const elapsed = formatOrchestratorSpawnElapsed(spawn.startedAt);
    const progress = spawn.progress;
    const stallHint = progress
      ? formatOrchestratorStallHint(progress, spawn.startedAt)
      : undefined;
    const detail =
      progress?.activityLines.at(-1) ??
      progress?.lastToolLine ??
      stallHint ??
      progress?.textPreview;
    if (detail) {
      return `${label}: ${agents[0]} — ${elapsed} · ${detail}`;
    }
    const turns = spawn.progress?.turns ?? 0;
    return `${label}: ${agents[0]} — ${elapsed} · turn ${String(turns)}`;
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
  const container = new Container();
  if (activeSpawns.size === 0) {
    container.addChild(new Text(theme.fg("muted", "(orchestrator idle)"), 1, 0));
    return container;
  }

  if (activeSpawns.size === 1) {
    const spawn = activeSpawns.values().next().value;
    if (!spawn) {
      return container;
    }
    const elapsed = formatOrchestratorSpawnElapsed(spawn.startedAt);
    const progress = spawn.progress ?? {
      agent: spawn.agent,
      turns: 0,
      recentToolLines: [],
      activityLines: [],
    };
    const lines = formatOrchestratorProgressWidgetLines(spawn.label, spawn.agent, progress, {
      startedAt: spawn.startedAt,
    });
    lines[0] = `${lines[0]} · ${elapsed}`;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      if (line === undefined) continue;
      const styled =
        lineIndex === 0 ? theme.fg("accent", line) : theme.fg("toolOutput", line);
      container.addChild(new Text(styled, 1, 0));
    }
    return container;
  }

  const lines = formatOrchestratorSpawnStatusLines();
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

/** Repaint status/widget while subprocess is running (extension commands block the main loop). */
export function startOrchestratorSpawnHeartbeat(
  ctx: Pick<ExtensionCommandContext, "hasUI" | "ui">,
): void {
  heartbeatCtx = ctx;
  if (heartbeatTimer) {
    return;
  }
  heartbeatTimer = setInterval(() => {
    if (activeSpawns.size === 0 || !heartbeatCtx) {
      return;
    }
    refreshOrchestratorSubagentChatDisplays();
    void refreshOrchestratorSpawnUi(heartbeatCtx);
  }, ORCHESTRATOR_SPAWN_HEARTBEAT_MS);
}

export function stopOrchestratorSpawnHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  }
  heartbeatCtx = undefined;
}

export function registerOrchestratorSpawn(
  spawnId: string,
  info: { label: string; agent: string },
): void {
  activeSpawns.set(spawnId, {
    label: info.label,
    agent: info.agent,
    startedAt: Date.now(),
  });
}

export function updateOrchestratorSpawn(spawnId: string, progress: SubagentProgress): void {
  const row = activeSpawns.get(spawnId);
  if (!row) {
    return;
  }
  row.progress = progress;
}

export function unregisterOrchestratorSpawn(spawnId: string): void {
  activeSpawns.delete(spawnId);
  if (activeSpawns.size === 0) {
    stopOrchestratorSpawnHeartbeat();
  }
}
