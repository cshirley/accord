import { defineTool } from "../framework.js";
import { runPrReviewPost } from "../lib/review/pr.js";

type Params = {
  temp_dir: string;
  summary: string;
  extra_findings_json?: string;
  dry_run?: boolean;
  submit?: "pending" | "comment-batches";
  batch_size?: number;
  pause_seconds?: number;
  resume_from?: number;
};

export default defineTool<Params>({
  name: "pr_review_post",
  label: "PR Review Post",
  description:
    "Create a PENDING (draft) GitHub review from pr_review_report's findings: inline comments on lines that are in the diff, the rest in the body. Never submits and never sets a verdict; the human finishes the review on GitHub. Refuses if the PR head moved. Only call after the user has seen the report and agreed to a draft review.",
  promptSnippet: "Create a pending inline PR review (never submits)",
  params: {
    temp_dir: { type: "string", description: "details.temp_dir from pr_review_context" },
    summary: { type: "string", description: "Review body shown first" },
    extra_findings_json: {
      type: "string",
      required: false,
      description:
        "Extra findings (e.g. cross-shard) as a JSON array of { severity, message, file?, line?, agent? }",
    },
    dry_run: {
      type: "boolean",
      required: false,
      description: "Return the payload without calling GitHub",
    },
    submit: {
      type: "string",
      required: false,
      description:
        "pending (default): one draft the human submits. comment-batches: SUBMITS COMMENT reviews, batch_size inline comments each. Only when the user asked for submitted reviews.",
    },
    batch_size: {
      type: "number",
      required: false,
      description: "Inline comments per review for comment-batches. Default 20, max 25.",
    },
    pause_seconds: {
      type: "number",
      required: false,
      description: "Seconds between batches. Default 30.",
    },
    resume_from: {
      type: "number",
      required: false,
      description: "Inline comments already posted by an interrupted run; skip this many.",
    },
  },
  progress: "Creating pending review…",
  async execute(params, { signal }) {
    return runPrReviewPost(params, undefined, signal);
  },
});
