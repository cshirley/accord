import { defineTool } from "../framework.js";
import { type PrReviewContextParams, parsePrNumber, runPrReviewContext } from "../lib/review/pr.js";

export type Params = {
  pr: string;
  max_shards?: number;
  budget_kb?: number;
  single_shard_max_files?: number;
  worktree?: boolean;
  lens?: boolean;
  runs?: number;
  models?: string[];
};

/** Every tool parameter reaches the lib: a dropped one silently falls back to its default. */
export function toContextParams(params: Params, pr: number): PrReviewContextParams {
  return {
    pr,
    ...(params.max_shards !== undefined ? { max_shards: params.max_shards } : {}),
    ...(params.budget_kb !== undefined ? { budget_kb: params.budget_kb } : {}),
    ...(params.single_shard_max_files !== undefined
      ? { single_shard_max_files: params.single_shard_max_files }
      : {}),
    ...(params.runs !== undefined ? { runs: params.runs } : {}),
    ...(params.models !== undefined ? { models: params.models } : {}),
    ...(params.lens !== undefined ? { lens: params.lens } : {}),
    ...(params.worktree !== undefined ? { worktree: params.worktree } : {}),
  };
}

export default defineTool<Params>({
  name: "pr_review_context",
  label: "PR Review Context",
  description:
    "Prepare a GitHub PR for sharded standalone review: PR metadata, a detached head worktree beside the repo, per-file diff split into shards with a verified partition, a manifest, and ready subagent tasks (review-code, review-security). Does not post anything.",
  promptSnippet: "Prepare a PR for sharded review (worktree, shards, tasks)",
  params: {
    pr: { type: "string", description: "PR number or URL" },
    max_shards: {
      type: "number",
      required: false,
      description:
        "Shard count safety cap (default 24). The count is ceil(total / budget_kb), so the cap only bites on huge PRs.",
    },
    budget_kb: {
      type: "number",
      required: false,
      description:
        "Target KiB per shard (default 60). Smaller shards are reviewed more deeply but cost more tokens.",
    },
    single_shard_max_files: {
      type: "number",
      required: false,
      description:
        "At or under this many files (and one budget of bytes) the PR is a single shard (default 20)",
    },
    models: {
      type: "string[]",
      required: false,
      description:
        'One model per run, up to 3, e.g. ["claude-sonnet-5.5", "claude-opus-5.5"]; sets the run count and overrides runs. Models make different mistakes, so a mixed pair beats the same model twice. Default: sonnet then opus on github-copilot or anthropic, else the same model twice. A critical reported by one non-Claude model alone is shown as a warning. Model ids are provider-specific (Copilot: claude-opus-5.5; Anthropic: claude-opus-5-5).',
    },
    runs: {
      type: "number",
      required: false,
      description:
        "Repeat every reviewer task this many times, 1 to 3 (default 2). Runs differ, so more runs find more; findings are merged by location and each comment says how many runs reported it.",
    },
    lens: {
      type: "boolean",
      required: false,
      description:
        "Append the review lens to each brief: STRIDE for review-security, doc-versus-code and no-cap rules for review-code, no-spec checks for review-test, and an explicit return shape (default true; false gives the bare briefs, for comparison)",
    },
    worktree: {
      type: "boolean",
      required: false,
      description: "Create a detached head worktree (default true)",
    },
  },
  progress: "Preparing PR review…",
  async execute(params, { cwd, signal }) {
    const pr = parsePrNumber(params.pr);
    if (pr === null) return { text: `Not a PR number or URL: ${params.pr}`, isError: true };
    return runPrReviewContext(cwd, toContextParams(params, pr), signal);
  },
});
