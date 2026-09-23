/**
 * repo_harness_context — Dev Harness config from AGENTS.md / accord.json chain.
 */

import { loadDevHarnessConfig } from "@clive.shirley/accord-core/config/index.js";
import type { DevHarnessConfig } from "@clive.shirley/accord-core/config/types.js";

export interface RepoHarnessContextData {
  agentsMdFound: boolean;
  config: DevHarnessConfig | null;
  suggestedVerifyCwd: string;
}

export function formatRepoHarnessContext(d: RepoHarnessContextData): string {
  const out: string[] = [];
  out.push(`Dev Harness: ${d.config ? "✓ loaded" : d.agentsMdFound ? "✗ invalid/missing JSON" : "✗ no AGENTS.md"}`);
  out.push(`Suggested verify cwd: ${d.suggestedVerifyCwd}`);

  if (!d.config) return out.join("\n");

  const c = d.config;
  out.push(`Language: ${c.language}`);
  if (c.tracker?.type) out.push(`Tracker: ${c.tracker.type}`);
  out.push(`\nTest: \`${c.test.command}\`${c.test.file_pattern ? ` (pattern: ${c.test.file_pattern})` : ""}`);
  if (c.type_check) out.push(`Type check: \`${c.type_check}\``);
  if (c.lint) out.push(`Lint: \`${c.lint}\``);

  out.push(`\nVerification commands (${c.verification_commands.length}):`);
  for (const cmd of c.verification_commands) {
    out.push(`  - \`${cmd}\``);
  }

  return out.join("\n");
}

export function runRepoHarnessContext(cwd: string): RepoHarnessContextData {
  const config = loadDevHarnessConfig(cwd);
  return {
    agentsMdFound: config !== null,
    config,
    suggestedVerifyCwd: cwd,
  };
}
