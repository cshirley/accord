/**
 * Git Tools Extension
 *
 * Registers tools for commit and PR workflows:
 *   git_commit_context  — gather commit context (status/diff/log/secrets/artifacts)
 *   git_commit_execute  — stage files + commit
 *   gh_pr_context       — gather PR context (existing PR/commits/spec/verify)
 *   gh_pr_submit        — push + optionally create PR
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommitTools } from "./commit.js";
import { registerPrTools } from "./pr.js";

export default function (pi: ExtensionAPI) {
  registerCommitTools(pi);
  registerPrTools(pi);
}
