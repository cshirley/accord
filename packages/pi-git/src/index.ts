/**
 * Git extension — commit/PR/review tools, worktrees, and /wt.
 *
 * To add a tool:
 *   1. Implement logic under lib/ (or worktree/ for session-scoped tools)
 *   2. Add defs/<name>.ts exporting defineTool({ ... })
 *   3. Import here and append to toolDefs
 *
 * Worktree wt_* tools are registered inside initWorktreeSession (session-scoped state).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import ghPrContext from "./defs/gh-pr-context.js";
import ghPrSubmit from "./defs/gh-pr-submit.js";
import gitCommitContext from "./defs/git-commit-context.js";
import gitCommitExecute from "./defs/git-commit-execute.js";
import gitReviewContext from "./defs/git-review-context.js";
import { registerToolDefs } from "./framework.js";
import { initWorktreeSession } from "./worktree/runtime.js";

export default function gitExtension(pi: ExtensionAPI) {
  initWorktreeSession(pi);

  const toolDefs = [
    gitCommitContext,
    gitCommitExecute,
    ghPrContext,
    ghPrSubmit,
    gitReviewContext,
  ];

  registerToolDefs(pi, toolDefs);

  console.log(`🌿 pi-git loaded: ${toolDefs.length + 7} tools, /wt command`);
}
