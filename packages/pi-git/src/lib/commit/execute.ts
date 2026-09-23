/**
 * git_commit_execute — stage files and commit
 */

import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { git, gitRoot, validateCommitMessage, withTempFile } from "../git.js";

export async function runGitCommitExecute(
  cwd: string,
  files: string[],
  message: string,
  signal: AbortSignal | undefined,
  onUpdate: ((partial: AgentToolResult<unknown>) => void) | undefined,
) {
  const root = await gitRoot(cwd, signal);

  if (!files.length) throw new Error("No files to stage.");

  onUpdate?.({
    content: [{ type: "text", text: `Staging ${files.length} file(s)...` }],
    details: { progress: 20 },
  });

  for (const file of files) {
    await git(["add", "--", file], root, signal);
  }

  const staged = await git(["diff", "--staged", "--stat"], root, signal);
  if (!staged.trim()) throw new Error("Nothing staged. Files may be unchanged.");

  onUpdate?.({
    content: [{ type: "text", text: "Committing..." }],
    details: { progress: 70 },
  });

  const warnings = validateCommitMessage(message);
  await withTempFile(message, (msgFile) => git(["commit", "-F", msgFile], root, signal));

  const hash = (await git(["rev-parse", "--short", "HEAD"], root, signal)).trim();
  const postStatus = (await git(["status"], root, signal)).trim();

  const warningText = warnings.length
    ? `\n\n⚠ Format warnings:\n${warnings.map((w) => `  ${w.field}: ${w.message}`).join("\n")}`
    : "";

  return {
    text: `Committed ${hash}${warningText}\n\n${postStatus}`,
    details: { commitHash: hash, postStatus, warnings },
  };
}
