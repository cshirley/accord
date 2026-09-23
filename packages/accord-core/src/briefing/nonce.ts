import { randomBytes } from "node:crypto";

/** Six-char hex owner token for per-task files (gates cross-worktree tampering). */
export function devNonce(): string {
  return randomBytes(3).toString("hex");
}
