/**
 * Lightweight credential checks for model profile fallback (no Pi runtime dependency).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { resolvePiAgentDir } from "../config/paths.js";

/** Provider name for Cursor-backed profiles. */
export const CURSOR_PROVIDER = "cursor";

function resolveAgentCredentialsDir(): string {
  return (
    process.env.PI_CODING_AGENT_DIR?.trim() ||
    process.env.ACCORD_PI_AGENT_DIR?.trim() ||
    resolvePiAgentDir()
  );
}

/** Return true when Pi auth store contains a credential for `provider`. */
export function readStoredCredential(provider: string): boolean {
  const authPath = path.join(resolveAgentCredentialsDir(), "auth.json");
  try {
    const raw = fs.readFileSync(authPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const entry = parsed[provider];
    if (!entry || typeof entry !== "object") return false;
    const record = entry as Record<string, unknown>;
    return Boolean(record.access || record.apiKey || record.token);
  } catch {
    return false;
  }
}

export function hasCursorCredentials(): boolean {
  if (process.env.CURSOR_API_KEY || process.env.CURSOR_ACCESS_TOKEN) return true;
  return readStoredCredential(CURSOR_PROVIDER);
}
