import { requireEnv } from "../lib/env.js";

export const CI_PUSH_TOKEN_NAME = "ACCORD_CI_PUSH_TOKEN";

/** Fail startup before any git or gh call when the push token is missing. Never returns the token. */
export function assertCiDrivenEnv(): void {
  requireEnv(CI_PUSH_TOKEN_NAME);
}
