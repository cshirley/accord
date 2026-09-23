/**
 * Interactive harness selection when multiple runtimes are installed.
 */

import * as readline from "node:readline";
import type { DetectedHarness } from "./detect-harnesses.js";

export async function promptHarnessSelection(
  installed: DetectedHarness[],
  options?: { defaultId?: string },
): Promise<string> {
  if (installed.length === 0) {
    throw new Error("No agent runtimes detected. Install `pi`, `claude`, or `agent` (Cursor) first.");
  }
  if (installed.length === 1) {
    return installed[0]?.id ?? "claude";
  }

  const defaultId = options?.defaultId ?? installed[0]?.id;
  const lines = installed.map((backend, index) => {
    const marker = backend.id === defaultId ? " (default)" : "";
    return `  ${String(index + 1)}. ${backend.id} — ${backend.label}${marker}`;
  });

  process.stdout.write(
    ["Multiple agent runtimes detected. Select default harness:", ...lines, ""].join("\n"),
  );

  const answer = await new Promise<string>((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`Enter number or id [${defaultId}]: `, (value) => {
      rl.close();
      resolve(value.trim());
    });
  });

  if (!answer) return defaultId ?? installed[0]!.id;
  const asNumber = Number.parseInt(answer, 10);
  if (Number.isFinite(asNumber) && asNumber >= 1 && asNumber <= installed.length) {
    return installed[asNumber - 1]!.id;
  }
  const match = installed.find((backend) => backend.id === answer.toLowerCase());
  if (match) return match.id;
  throw new Error(`Invalid selection: ${answer}`);
}
