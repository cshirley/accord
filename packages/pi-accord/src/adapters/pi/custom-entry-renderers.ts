/**
 * Display-only session entry renderers (`registerEntryRenderer`) for appendEntry markers.
 * Custom entries do not enter LLM context; these style scrollback and /tree.
 */

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";

export const HARNESS_RUN_ENTRY_TYPE = "dev-harness-run";

export type HarnessRunEntryData = {
  schema_version?: string;
  harness_run_id?: string;
  harness_session_tag?: string;
  work_item_id?: string;
  work_item_ids?: string[];
  auto_provisioned?: boolean;
  cwd?: string;
  updated_at?: string;
};

function joinIds(ids: string[] | undefined, single: string | undefined): string | undefined {
  if (ids && ids.length > 0) return ids.join(", ");
  if (single) return single;
  return undefined;
}

export function renderHarnessRunEntry(data: HarnessRunEntryData, theme: Theme): Container {
  const container = new Container();
  container.addChild(new Text(theme.fg("accent", theme.bold(" ACCORD harness run")), 0, 0));

  const tag = data.harness_session_tag?.trim();
  const runId = data.harness_run_id?.trim();
  if (tag) container.addChild(new Text(theme.fg("text", `  tag: ${tag}`), 0, 0));
  if (runId) container.addChild(new Text(theme.fg("text", `  run_id: ${runId}`), 0, 0));

  const workItems = joinIds(data.work_item_ids, data.work_item_id);
  if (workItems) {
    container.addChild(new Text(theme.fg("text", `  work items: ${workItems}`), 0, 0));
  }

  const auto = data.auto_provisioned ? "yes" : "no";
  container.addChild(new Text(theme.fg("muted", `  auto-provisioned: ${auto}`), 0, 0));

  return container;
}

export function registerHarnessRunEntryRenderer(pi: ExtensionAPI): void {
  pi.registerEntryRenderer<HarnessRunEntryData>(
    HARNESS_RUN_ENTRY_TYPE,
    (entry, _options, theme) => {
      if (!entry.data) return undefined;
      return renderHarnessRunEntry(entry.data, theme);
    },
  );
}
