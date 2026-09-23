/**
 * Build subagent task briefs for standalone review (Pi `/review` skill).
 */

import {
  buildStandaloneReviewTasks,
  type StandaloneReviewLegacySource,
  type StandaloneReviewLocalLayer,
} from "@clive.shirley/accord-core/review/standalone.js";

export function runGitReviewTasks(input: {
  diff_path: string;
  source: StandaloneReviewLegacySource;
  file_list: string[];
  local_layers?: StandaloneReviewLocalLayer[];
  test_output?: string;
}) {
  const tasks = buildStandaloneReviewTasks({
    diff_path: input.diff_path,
    source: input.source,
    file_list: input.file_list,
    local_layers: input.local_layers,
    test_output: input.test_output,
  });
  return { tasks };
}

export function formatReviewTasks(d: { tasks: { agent: string; task: string }[] }): string {
  const agents = d.tasks.map((task) => task.agent).join(", ");
  const hasTestTask = d.tasks.some((task) => task.agent === "review-test");
  const waveHint = hasTestTask
    ? " When tests apply: run review-code + review-security first (omit review-test); after test_output exists, call again with test_output and spawn only review-test."
    : " Pass details.tasks to subagent in one parallel call.";
  return `Built ${String(d.tasks.length)} subagent task(s): ${agents}.${waveHint}`;
}
