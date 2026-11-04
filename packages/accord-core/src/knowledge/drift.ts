import { loadFeatureDocs } from "./feature-doc.js";

export type DriftSeverity = "off" | "warn" | "block";

export interface DriftOptions {
  repoRoot: string;
  workItemId: string;
  /** Repo-relative files changed by the work item. */
  changedFiles: string[];
  severity: DriftSeverity;
  /** Feature docs root relative to repoRoot. Default docs/features. */
  root?: string;
  /** Feature slugs declared unchanged for this work item. */
  declaredUnchanged?: string[];
}

export interface DriftFinding {
  feature: string;
  files: string[];
}

export interface DriftResult {
  ok: boolean;
  severity: DriftSeverity;
  findings: DriftFinding[];
}

const normalisePath = (path: string): string => path.replace(/\\/g, "/").replace(/^(\.\/)+/, "");

export function checkDrift(options: DriftOptions): DriftResult {
  const { severity, workItemId } = options;
  if (severity === "off") return { ok: true, severity, findings: [] };
  const unchanged = new Set(options.declaredUnchanged ?? []);
  const changed = [...new Set(options.changedFiles.map(normalisePath))];
  const findings: DriftFinding[] = [];
  for (const doc of loadFeatureDocs(options.repoRoot, options.root)) {
    if (unchanged.has(doc.id)) continue;
    const anchors = new Set(doc.anchors.code.map(normalisePath));
    const files = changed.filter((file) => anchors.has(file));
    if (files.length === 0) continue;
    const updated = doc.changes.some(
      (entry) =>
        entry !== null &&
        typeof entry === "object" &&
        (entry as { work_item?: unknown }).work_item === workItemId,
    );
    if (!updated) findings.push({ feature: doc.id, files });
  }
  return { ok: severity === "warn" || findings.length === 0, severity, findings };
}
