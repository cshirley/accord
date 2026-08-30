/**
 * Display-only renderer for per-session output level markers (`appendEntry`).
 */

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import type { OutputLevel } from "./config.js";

export const OUTPUT_LEVEL_ENTRY_TYPE = "thrift-output-level";
/** Legacy session entry key — read for backward compat with old sessions. */
export const LEGACY_OUTPUT_LEVEL_ENTRY_TYPE = "tp-output-level";

export type OutputLevelEntryData = { level?: OutputLevel | string };

export function renderOutputLevelEntry(data: OutputLevelEntryData, theme: Theme): Container {
  const container = new Container();
  const level = data.level ?? "unknown";
  container.addChild(new Text(theme.fg("accent", theme.bold(" thrift output")), 0, 0));
  container.addChild(new Text(theme.fg("text", `  level: ${level}`), 0, 0));
  return container;
}

export function registerOutputLevelEntryRenderer(pi: ExtensionAPI): void {
  const render = (entry: { data?: OutputLevelEntryData }, _options: unknown, theme: Theme) => {
    if (!entry.data) return undefined;
    return renderOutputLevelEntry(entry.data, theme);
  };
  pi.registerEntryRenderer<OutputLevelEntryData>(OUTPUT_LEVEL_ENTRY_TYPE, render);
  pi.registerEntryRenderer<OutputLevelEntryData>(LEGACY_OUTPUT_LEVEL_ENTRY_TYPE, render);
}
