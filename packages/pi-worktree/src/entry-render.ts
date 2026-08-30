/**
 * Display-only renderer for persisted worktree state (`appendEntry`).
 */

import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";

export const WORKTREE_STATE_ENTRY_TYPE = "worktree-state";

export type WorktreeEntryData = {
  path: string;
  branch: string;
  baseBranch: string;
  createdAt: string;
};

export type WorktreeStateEntryData = {
  worktrees?: Record<string, WorktreeEntryData>;
};

export function renderWorktreeStateEntry(data: WorktreeStateEntryData, theme: Theme): Container {
  const container = new Container();
  const entries = Object.entries(data.worktrees ?? {});
  container.addChild(
    new Text(theme.fg("accent", theme.bold(` worktrees (${entries.length})`)), 0, 0),
  );

  if (entries.length === 0) {
    container.addChild(new Text(theme.fg("muted", "  (none)"), 0, 0));
    return container;
  }

  for (const [name, wt] of entries) {
    container.addChild(
      new Text(
        theme.fg("text", `  ${name}: ${wt.branch} @ ${wt.path} (base: ${wt.baseBranch})`),
        0,
        0,
      ),
    );
  }

  return container;
}

export function registerWorktreeStateEntryRenderer(pi: ExtensionAPI): void {
  pi.registerEntryRenderer<WorktreeStateEntryData>(WORKTREE_STATE_ENTRY_TYPE, (entry, _options, theme) => {
    if (!entry.data) return undefined;
    return renderWorktreeStateEntry(entry.data, theme);
  });
}
