/**
 * Path normalization for harness artifact validation (write/edit interception).
 */

/** Map absolute or nested paths to `.tasks/...` or `docs/...` prefix when applicable. */
export function normalizeHarnessRelativePath(filePath: string): string {
  return filePath.replace(/^.*\/(\.tasks\/)/, "$1").replace(/^.*\/(docs\/)/, "$1");
}

/** True when the path targets harness runtime (`.tasks/`) or committed artifacts (`docs/dev/`). */
export function isHarnessArtifactPath(filePath: string): boolean {
  const norm = normalizeHarnessRelativePath(filePath);
  return /^\.tasks\//.test(norm) || /^docs\/dev\//.test(norm);
}

export function isHarnessTrackedJsonWritePath(filePath: string): boolean {
  if (!filePath.endsWith(".json")) return false;
  const normPath = normalizeHarnessRelativePath(filePath);
  return /^\.tasks\//.test(normPath) || /^docs\/dev\//.test(normPath);
}

export function isAgentsMdPath(filePath: string | undefined): boolean {
  return !!filePath?.endsWith("AGENTS.md");
}
