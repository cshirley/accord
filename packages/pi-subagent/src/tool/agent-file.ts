import * as path from "node:path";
import type { AgentConfig } from "../agents.js";

/** Only use explicit agent paths that match the named agent in the current discovery set. */
export function resolveTrustedAgentFile(
  agentName: string,
  agents: AgentConfig[],
  explicitPath?: string,
): string | undefined {
  const discovered = agents.find((candidate) => candidate.name === agentName)?.filePath;
  if (!explicitPath) return discovered ?? undefined;

  const resolvedExplicit = path.resolve(explicitPath);
  if (discovered && path.resolve(discovered) === resolvedExplicit) {
    return discovered;
  }

  const catalogMatch = agents.find(
    (candidate) => path.resolve(candidate.filePath) === resolvedExplicit,
  );
  if (catalogMatch && catalogMatch.name === agentName) {
    return catalogMatch.filePath;
  }

  return discovered ?? undefined;
}
