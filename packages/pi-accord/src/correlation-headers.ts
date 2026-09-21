/**
 * Harness run / work-item correlation headers for provider request tracing.
 */

export const ACCORD_RUN_ID_HEADER = "X-Accord-Run-Id";
export const ACCORD_SESSION_TAG_HEADER = "X-Accord-Session-Tag";
export const ACCORD_WORK_ITEM_ID_HEADER = "X-Accord-Work-Item-Id";

export interface HarnessCorrelationContext {
  runId?: string;
  sessionTag?: string;
  workItemId?: string;
}

/** Build optional correlation headers for `before_provider_headers`. */
export function buildHarnessCorrelationHeaders(
  context: HarnessCorrelationContext,
): Record<string, string> {
  const headers: Record<string, string> = {};
  const runId = context.runId?.trim();
  const sessionTag = context.sessionTag?.trim();
  const workItemId = context.workItemId?.trim();
  if (runId) headers[ACCORD_RUN_ID_HEADER] = runId;
  if (sessionTag) headers[ACCORD_SESSION_TAG_HEADER] = sessionTag;
  if (workItemId) headers[ACCORD_WORK_ITEM_ID_HEADER] = workItemId;
  return headers;
}
