/**
 * Built-in read/write/edit render overrides — highlight harness artifact paths in the TUI.
 * Execution delegates to Pi's create*Tool factories; only renderCall is customized.
 */

import { isHarnessArtifactPath } from "@clive.shirley/accord-core/harness/paths.js";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { createEditTool, createReadTool, createWriteTool } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

export function formatHarnessToolPath(path: string, theme: Theme): string {
  if (isHarnessArtifactPath(path)) {
    return `${theme.fg("warning", path)}${theme.fg("muted", " · harness artifact")}`;
  }
  return theme.fg("accent", path);
}

/** Re-register read/write/edit with harness-aware renderCall; execution unchanged. */
export function registerHarnessBuiltinToolRenders(pi: ExtensionAPI, cwd: string): void {
  const originalRead = createReadTool(cwd);
  pi.registerTool({
    name: "read",
    label: "read",
    description: originalRead.description,
    parameters: originalRead.parameters,
    async execute(toolCallId, params, signal, onUpdate) {
      return originalRead.execute(toolCallId, params, signal, onUpdate);
    },
    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("read "));
      text += formatHarnessToolPath(args.path, theme);
      if (args.offset || args.limit) {
        const parts: string[] = [];
        if (args.offset) parts.push(`offset=${String(args.offset)}`);
        if (args.limit) parts.push(`limit=${String(args.limit)}`);
        text += theme.fg("dim", ` (${parts.join(", ")})`);
      }
      return new Text(text, 0, 0);
    },
  });

  const originalWrite = createWriteTool(cwd);
  pi.registerTool({
    name: "write",
    label: "write",
    description: originalWrite.description,
    parameters: originalWrite.parameters,
    async execute(toolCallId, params, signal, onUpdate) {
      return originalWrite.execute(toolCallId, params, signal, onUpdate);
    },
    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("write "));
      text += formatHarnessToolPath(args.path, theme);
      const lineCount = args.content.split("\n").length;
      text += theme.fg("dim", ` (${String(lineCount)} lines)`);
      return new Text(text, 0, 0);
    },
  });

  const originalEdit = createEditTool(cwd);
  pi.registerTool({
    name: "edit",
    label: "edit",
    description: originalEdit.description,
    parameters: originalEdit.parameters,
    async execute(toolCallId, params, signal, onUpdate) {
      return originalEdit.execute(toolCallId, params, signal, onUpdate);
    },
    renderCall(args, theme) {
      let text = theme.fg("toolTitle", theme.bold("edit "));
      text += formatHarnessToolPath(args.path, theme);
      return new Text(text, 0, 0);
    },
  });
}
