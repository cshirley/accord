/**
 * Required-env-var helper for `scripts/ci/**`.
 *
 * AC-20..AC-25 in `docs/dev/TICKET-TO-PR-1/spec.json`: missing required env
 * vars must fail startup with non-zero exit and a literal
 * `MISSING_REQUIRED_SECRET: <NAME>` message, BEFORE any LLM / Jira / GitHub
 * call. Throws are synchronous and side-effect-free so callers can wrap
 * startup in try/catch and translate to a non-zero process exit.
 *
 * Empty-string env values are treated as missing — defence in depth against
 * GitHub Actions injecting `""` for unset secrets at the `env:` step level.
 */

export const SECRET_NAMES = [
  "ANTHROPIC_API_KEY",
  "JIRA_BASE_URL",
  "JIRA_USER_EMAIL",
  "JIRA_API_TOKEN",
  "GITHUB_TOKEN",
  "GH_PAT_PR",
] as const;

export type SecretName = (typeof SECRET_NAMES)[number];

export class MissingSecretError extends Error {
  readonly secretName: string;

  constructor(secretName: string) {
    super(`MISSING_REQUIRED_SECRET: ${secretName}`);
    this.name = "MissingSecretError";
    this.secretName = secretName;
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new MissingSecretError(name);
  }
  return value;
}

export interface ResolveGithubTokenOpts {
  /** True when the workflow needs to push to a repo other than the runner repo. */
  crossRepo: boolean;
}

/**
 * Pick the right GitHub token for the current workflow segment.
 *
 * Same-repo (default GitHub Actions checkout): prefer `GH_PAT_PR` when set
 * (consumer override per AC-24), else fall back to the runner-provided
 * `GITHUB_TOKEN`. Missing both → throws `MISSING_REQUIRED_SECRET: GITHUB_TOKEN`.
 *
 * Cross-repo (PRs across consumer repos / forks): `GH_PAT_PR` is mandatory
 * per AC-25 — `GITHUB_TOKEN` is scoped to the runner repo and cannot push
 * elsewhere. Missing `GH_PAT_PR` → throws `MISSING_REQUIRED_SECRET: GH_PAT_PR`
 * regardless of whether `GITHUB_TOKEN` is set.
 */
export function resolveGithubToken(opts: ResolveGithubTokenOpts): string {
  const ghPat = process.env.GH_PAT_PR;
  const ghToken = process.env.GITHUB_TOKEN;
  const hasGhPat = ghPat !== undefined && ghPat !== "";
  const hasGhToken = ghToken !== undefined && ghToken !== "";

  if (opts.crossRepo) {
    if (!hasGhPat) {
      throw new MissingSecretError("GH_PAT_PR");
    }
    return ghPat as string;
  }

  if (hasGhPat) {
    return ghPat as string;
  }
  if (hasGhToken) {
    return ghToken as string;
  }
  throw new MissingSecretError("GITHUB_TOKEN");
}
