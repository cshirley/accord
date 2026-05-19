/**
 * Post-result handler registry — dispatches a validated subagent return packet
 * to any handler keyed on the agent id. Handlers are pure functions over
 * `(workItemId, packet, devConfig)` returning markdown to append (or `""`).
 *
 * Adding a new handler:
 *   1. Write `apply<...>PostResult` in a sibling file.
 *   2. Register it under its agent id in `POST_RESULT_HANDLERS` below.
 */

import type { DevHarnessConfig } from "../../config/types.js";
import { applyPhaseCodePostResult } from "./phase-code.js";
import { applyPhaseTestPostResult } from "./phase-test.js";
import { applyPhaseVerifyAcceptancePostResult } from "./phase-verify-acceptance.js";
import { applyReviewCodePostResult } from "./review-code.js";
import { applyReviewTestPostResult } from "./review-test.js";

export type PostResultHandler = (
  workItemId: string,
  packet: unknown,
  devConfig: DevHarnessConfig | null | undefined,
) => string;

export const POST_RESULT_HANDLERS: Readonly<Record<string, PostResultHandler>> = {
  "phase-test": applyPhaseTestPostResult,
  "review-test": applyReviewTestPostResult,
  "phase-code": applyPhaseCodePostResult,
  "review-code": applyReviewCodePostResult,
  "phase-verify-acceptance": applyPhaseVerifyAcceptancePostResult,
};

/**
 * Runs the registered handler for `agentId` (if any) and returns its markdown.
 * Returns `""` when no handler is registered or `workItemId` is empty.
 */
export function runPostResultHandlerForAgent(
  agentId: string,
  workItemId: string,
  packet: unknown,
  devConfig: DevHarnessConfig | null | undefined,
): string {
  if (!agentId || !workItemId) {
    return "";
  }
  const handler = POST_RESULT_HANDLERS[agentId];
  return handler ? handler(workItemId, packet, devConfig) : "";
}
