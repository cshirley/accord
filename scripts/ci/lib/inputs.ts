/**
 * AC-15 single source of truth for the reusable-workflow input surface.
 *
 * The autopipeline workflow file (.github/workflows/autopipeline.yml) is
 * generated/checked against this list — tests/ci/inputs-and-concurrency.test.ts
 * parses the YAML and asserts identity. Any change to the input set MUST be
 * made here first; the test will fail until the YAML is updated to match.
 *
 * Defaults match the AC-15 contract verbatim. Q1 + Q2 confirmed defaults:
 * `max_runtime_minutes`=90, `max_cost_usd`=20 — both configurable per-call.
 */

export type WorkflowInputType = "string" | "number" | "boolean";

export interface WorkflowInputSpec<T = string | number | boolean> {
  readonly name: string;
  readonly type: WorkflowInputType;
  readonly required: boolean;
  readonly default?: T;
  readonly description: string;
}

export const INPUTS = [
  {
    name: "ticket",
    type: "string",
    required: true,
    description: "Jira ticket key (e.g. PROJ-123). Required for both triggers.",
  },
  {
    name: "pi_version",
    type: "string",
    required: false,
    default: "latest",
    description: "npm tag or version of @mariozechner/pi-coding-agent.",
  },
  {
    name: "accord_ref",
    type: "string",
    required: false,
    default: "v1",
    description: "Tag/branch of pi-accord asset bundle to install.",
  },
  {
    name: "max_runtime_minutes",
    type: "number",
    required: false,
    default: 90,
    description: "Hard cap on job runtime. Workflow times out and posts a Jira blocker comment.",
  },
  {
    name: "max_cost_usd",
    type: "number",
    required: false,
    default: 20,
    description: "Hard cap on accumulated subagent USD cost. Phase agents abort + escalate.",
  },
  {
    name: "base_branch",
    type: "string",
    required: false,
    default: "main",
    description: "Branch the autopipeline branches from and opens PRs against.",
  },
  {
    name: "branch_prefix",
    type: "string",
    required: false,
    default: "accord/",
    description: "Prefix for the working branch (e.g. accord/PROJ-123-abc1234).",
  },
  {
    name: "dry_run",
    type: "boolean",
    required: false,
    default: false,
    description:
      "When true, runs the pipeline without pushing branches, opening PRs, or commenting on Jira.",
  },
  {
    name: "runner",
    type: "string",
    required: false,
    default: "ubuntu-latest",
    description: "GitHub-hosted runner label or self-hosted runner group.",
  },
  {
    name: "subagent_profile",
    type: "string",
    required: false,
    default: "anthropic-direct",
    description:
      "Name of the profile inside subagent.json to mark as activeProfile before any phase runs. The bundled CI template ships with one profile (anthropic-direct). Set this when consuming a checked-in custom subagent.json that defines additional profiles (e.g. cursor-claude, openai-direct).",
  },
] as const satisfies readonly WorkflowInputSpec[];

export type InputName = (typeof INPUTS)[number]["name"];

/**
 * Typed accessor for parsed input values. Workflow callers cast the parsed
 * `inputs` object (from `github.event.inputs` for repository_dispatch or
 * `inputs.*` for workflow_call) to this shape AFTER applying defaults.
 */
export interface Inputs {
  ticket: string;
  pi_version: string;
  accord_ref: string;
  max_runtime_minutes: number;
  max_cost_usd: number;
  base_branch: string;
  branch_prefix: string;
  dry_run: boolean;
  runner: string;
  subagent_profile: string;
}

/** AC-15 required-secret list — mirrored in scripts/ci/lib/env.ts SECRET_NAMES (minus the optional GH_PAT_PR). */
export const REQUIRED_SECRETS = [
  "ANTHROPIC_API_KEY",
  "JIRA_BASE_URL",
  "JIRA_USER_EMAIL",
  "JIRA_API_TOKEN",
] as const;

export const OPTIONAL_SECRETS = ["GH_PAT_PR"] as const;
