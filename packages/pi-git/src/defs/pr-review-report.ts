import { defineTool } from "../framework.js";
import { runPrReviewReport } from "../lib/review/pr.js";

type Params = { temp_dir: string; results_json: string };

export default defineTool<Params>({
  name: "pr_review_report",
  label: "PR Review Report",
  description:
    "Merge the return packets of a sharded PR review into one severity report with a Coverage section (assigned files vs files_reviewed, failed or unrun tasks). Reads temp_dir/context.json from pr_review_context; writes temp_dir/report.json.",
  promptSnippet: "Merge sharded PR review packets into a report with coverage",
  params: {
    temp_dir: { type: "string", description: "details.temp_dir from pr_review_context" },
    results_json: {
      type: "string",
      description: "JSON array of { shard, agent, exitCode, output, stderr? }, one per task run",
    },
  },
  progress: "Merging PR review results…",
  async execute(params) {
    return runPrReviewReport(params);
  },
});
