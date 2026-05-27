import { syncSpecMarkdownFromJson } from "../artifacts/spec-markdown.js";
import { validateArtifact } from "../artifacts/validation.js";
import { syncWorkflowCostMarkdownFromJson } from "../artifacts/workflow-cost-artifact.js";
import { isHarnessTrackedJsonWritePath, normalizeHarnessRelativePath } from "./paths.js";

/** User-facing block message when validation fails (host maps to tool_result shape). */
export function formatArtifactValidationFailureMessage(filePath: string, errors: string[]): string {
  return [
    `Schema validation failed for ${filePath}:`,
    ...errors.map((e) => `  • ${e}`),
    "",
    "Fix the JSON shape and retry.",
  ].join("\n");
}

/**
 * When a write/edit touches tracked harness JSON, validate on disk.
 * @returns `null` when this hook should not intercept; otherwise validation outcome.
 */
export async function validateHarnessArtifactWriteIfApplicable(
  filePath: string | undefined,
): Promise<{ skip: true } | { skip: false; valid: boolean; errors: string[] }> {
  if (!filePath || !isHarnessTrackedJsonWritePath(filePath)) {
    return { skip: true };
  }
  const result = await validateArtifact(filePath);
  if (result.valid) {
    const normPath = normalizeHarnessRelativePath(filePath);
    if (/\/docs\/dev\/[^/]+\/spec\.json$/i.test(normPath)) {
      syncSpecMarkdownFromJson(filePath);
    }
    if (/\/docs\/dev\/[^/]+\/workflow-cost\.json$/i.test(normPath)) {
      syncWorkflowCostMarkdownFromJson(filePath);
    }
  }
  return { skip: false, valid: result.valid, errors: result.errors };
}
