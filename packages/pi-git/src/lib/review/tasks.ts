/**
 * Build subagent task briefs for standalone review (Pi `/review` skill).
 */

import {
  buildStandaloneReviewTasks,
  type StandaloneReviewDiff,
} from "@clive.shirley/accord-core/review/standalone.js";

export function runGitReviewTasks(input: {
  diff_path: string;
  source: StandaloneReviewDiff["source"];
  file_list: string[];
  test_output?: string;
}) {
  const tasks = buildStandaloneReviewTasks({
    diff_path: input.diff_path,
    source: input.source,
    file_list: input.file_list,
    test_output: input.test_output,
  });
  return { tasks };
}

export function formatReviewTasks(d: { tasks: { agent: string; task: string }[] }): string {
  const agents = d.tasks.map((task) => task.agent).join(", ");
  return `Built ${String(d.tasks.length)} subagent task(s): ${agents}. Pass details.tasks to subagent in one parallel call.`;
}
