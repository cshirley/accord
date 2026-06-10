/** Extension stderr lines that are not actionable subagent progress. */
export function isSubagentStderrNoise(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) {
    return true;
  }
  if (/^📓|^🔗/.test(trimmed)) {
    return true;
  }
  if (/Journal tools loaded/i.test(trimmed)) {
    return true;
  }
  if (/Tools loaded:/i.test(trimmed)) {
    return true;
  }
  if (/tools loaded.*services/i.test(trimmed)) {
    return true;
  }
  return false;
}

/** True when a formatted activity line reflects a tool invocation (not lifecycle/status). */
export function looksLikeToolActivityLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("stderr:")) {
    return false;
  }
  if (
    /^(subagent process started|agent running|turn \d+ started|retry |compacting|thinking…|waiting for model|composing…)/.test(
      trimmed,
    )
  ) {
    return false;
  }
  return (
    /^(read |write |edit |\$ |grep |find |ls )/.test(trimmed) ||
    trimmed.includes(" (done)") ||
    trimmed.includes(" (failed)") ||
    /^[a-z][a-z0-9_-]*\s/.test(trimmed)
  );
}
