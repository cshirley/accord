/**
 * Shared parsing of Pi `subagent` tool payloads (agent / chain / tasks).
 */

export type SubagentEntry = { agent?: string; task?: string };

export function collectSubagentEntries(input: Record<string, unknown>): SubagentEntry[] {
  const entries: SubagentEntry[] = [];
  if (input.agent) entries.push(input as SubagentEntry);
  if (Array.isArray(input.chain)) entries.push(...(input.chain as SubagentEntry[]));
  if (Array.isArray(input.tasks)) entries.push(...(input.tasks as SubagentEntry[]));
  return entries;
}

/** First entry's agent — used for gather/verify preflight routing. */
export function firstSubagentAgentName(input: Record<string, unknown>): string {
  if (typeof input.agent === "string") return input.agent;
  const chain = input.chain as SubagentEntry[] | undefined;
  if (Array.isArray(chain) && chain[0]?.agent) return chain[0].agent!;
  const tasks = input.tasks as SubagentEntry[] | undefined;
  if (Array.isArray(tasks) && tasks[0]?.agent) return tasks[0].agent!;
  return "";
}

/**
 * The entry Pi mutates for `task` injection (single agent, or head of chain/tasks).
 */
export function getPrimarySubagentEntry(
  input: Record<string, unknown>,
): SubagentEntry | null {
  if (input.agent) return input as SubagentEntry;
  const chain = input.chain as SubagentEntry[] | undefined;
  if (Array.isArray(chain) && chain[0]) return chain[0];
  const tasks = input.tasks as SubagentEntry[] | undefined;
  if (Array.isArray(tasks) && tasks[0]) return tasks[0];
  return null;
}
