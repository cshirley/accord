/**
 * Detect installed agent runtime CLIs for accord.json generation.
 */

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { HarnessBackendDef } from "@clive.shirley/accord-core/config/types.js";

export type DetectedHarness = HarnessBackendDef & {
  installed: boolean;
  binary?: string;
};

function which(binary: string): string | undefined {
  const result = spawnSync("which", [binary], { encoding: "utf8" });
  const resolved = result.stdout?.trim();
  return resolved || undefined;
}

export function resolveAccordCliScriptsDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../scripts");
}

export function buildPiBackendCommand(): string[] {
  return [process.execPath, path.join(resolveAccordCliScriptsDir(), "pi-exec.ts")];
}

export function buildClaudeBackendCommand(): string[] {
  return [process.execPath, path.join(resolveAccordCliScriptsDir(), "claude-code-exec.ts")];
}

export function buildCursorBackendCommand(): string[] {
  return [process.execPath, path.join(resolveAccordCliScriptsDir(), "cursor-agent-exec.ts")];
}

const KNOWN_BACKENDS: Array<{
  id: string;
  label: string;
  kind: HarnessBackendDef["kind"];
  binary: string;
  binary_env: string;
  buildCommand: () => string[];
}> = [
  {
    id: "pi",
    label: "Pi CLI (pi --mode json)",
    kind: "pi",
    binary: "pi",
    binary_env: "ACCORD_PI_BIN",
    buildCommand: buildPiBackendCommand,
  },
  {
    id: "claude",
    label: "Claude Code (claude -p)",
    kind: "exec",
    binary: "claude",
    binary_env: "ACCORD_CLAUDE_CODE_BIN",
    buildCommand: buildClaudeBackendCommand,
  },
  {
    id: "cursor",
    label: "Cursor Agent (agent --print)",
    kind: "exec",
    binary: "agent",
    binary_env: "ACCORD_CURSOR_AGENT_BIN",
    buildCommand: buildCursorBackendCommand,
  },
];

export function detectInstalledHarnesses(): DetectedHarness[] {
  return KNOWN_BACKENDS.map((known) => {
    const installed = Boolean(which(known.binary));
    const binary = which(known.binary);
    return {
      id: known.id,
      label: known.label,
      kind: known.kind,
      installed,
      binary,
      binary_env: known.binary_env,
      command: [
        ...known.buildCommand(),
        "--agent={{agentId}}",
        "--agent-file={{agentFile}}",
        "--task-file={{taskFile}}",
        "--system-append-file={{systemAppendFile}}",
        "--cwd={{cwd}}",
      ],
      response_json: "stdout" as const,
    };
  });
}

export function detectInstalledHarnessIds(): string[] {
  return detectInstalledHarnesses()
    .filter((backend) => backend.installed)
    .map((backend) => backend.id);
}
