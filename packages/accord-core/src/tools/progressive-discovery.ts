/**
 * Progressive Pi tool discovery — shared registry, env gate, and search scoring.
 *
 * Extensions register searchable tool names, keep them inactive at session start,
 * and expose a single `search_accord_tools` loader (registered by pi-git).
 */

export const SEARCH_ACCORD_TOOLS = "search_accord_tools";

const searchableToolNames = new Set<string>();

/** Master switch: `PI_PROGRESSIVE_TOOLS=0` disables all packages. */
export function isProgressiveToolsEnabled(packageEnvVar?: string): boolean {
  const master = process.env.PI_PROGRESSIVE_TOOLS?.trim();
  if (master) {
    if (isDisabledToken(master)) return false;
    if (isEnabledToken(master)) return true;
  }
  if (packageEnvVar) {
    const pkg = process.env[packageEnvVar]?.trim();
    if (pkg) {
      if (isDisabledToken(pkg)) return false;
      if (isEnabledToken(pkg)) return true;
    }
  }
  return true;
}

function isDisabledToken(raw: string): boolean {
  const lower = raw.toLowerCase();
  return raw === "0" || lower === "false" || lower === "no" || lower === "off";
}

function isEnabledToken(raw: string): boolean {
  const lower = raw.toLowerCase();
  return raw === "1" || lower === "true" || lower === "yes" || lower === "on";
}

export function registerSearchableTools(names: readonly string[]): void {
  for (const name of names) {
    searchableToolNames.add(name);
  }
}

export function getRegisteredSearchableToolNames(): ReadonlySet<string> {
  return searchableToolNames;
}

export function clearSearchableToolsForTests(): void {
  searchableToolNames.clear();
}

export interface ScoredToolMatch {
  name: string;
  score: number;
}

export function scoreToolCatalog(
  catalog: ReadonlyArray<{ name: string; label?: string; description?: string }>,
  searchable: ReadonlySet<string>,
  query: string,
  limit: number,
): string[] {
  const terms = query.toLowerCase().split(/[^a-z0-9_+-]+/).filter(Boolean);
  if (terms.length === 0) return [];

  const scored: ScoredToolMatch[] = [];
  for (const tool of catalog) {
    if (!searchable.has(tool.name)) continue;
    const hay = `${tool.name} ${tool.label ?? ""} ${tool.description ?? ""}`.toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (hay.includes(term)) score += 1;
    }
    if (score > 0) scored.push({ name: tool.name, score });
  }

  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map((m) => m.name);
}

export function buildLoaderActiveSet(
  preservedToolNames: readonly string[],
  managedToHide: ReadonlySet<string>,
): string[] {
  const names = new Set<string>();
  for (const tool of preservedToolNames) {
    if (!managedToHide.has(tool)) names.add(tool);
  }
  names.add(SEARCH_ACCORD_TOOLS);
  return [...names];
}

type ToolsMatchedHandler = (toolNames: readonly string[]) => void;
const toolsMatchedHandlers: ToolsMatchedHandler[] = [];

export function registerToolsMatchedHandler(handler: ToolsMatchedHandler): void {
  toolsMatchedHandlers.push(handler);
}

export function clearToolsMatchedHandlersForTests(): void {
  toolsMatchedHandlers.length = 0;
}

export function notifyToolsMatched(toolNames: readonly string[]): void {
  for (const handler of toolsMatchedHandlers) {
    handler(toolNames);
  }
}
