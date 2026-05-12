/**
 * Path normalization for harness artifact validation (write/edit interception).
 */

/** Map absolute or nested paths to `.tasks/...` or `docs/...` prefix when applicable. */
export function normalizeHarnessRelativePath(filePath: string): string {
  return filePath.replace(/^.*\/(\.tasks\/)/, "$1").replace(/^.*\/(docs\/)/, "$1");
}

export function isHarnessTrackedJsonWritePath(filePath: string): boolean {
  if (!filePath.endsWith(".json")) return false;
  const normPath = normalizeHarnessRelativePath(filePath);
  return /^\.tasks\//.test(normPath) || /^docs\/dev\//.test(normPath);
}

export function isAgentsMdPath(filePath: string | undefined): boolean {
  return !!filePath?.endsWith("AGENTS.md");
}
