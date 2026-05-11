#!/usr/bin/env bun
/**
 * AC-1: Dispatch validation entry point.
 *
 * Reads the synthetic github event payload supplied by the workflow YAML and
 * returns `{ticket, statusAtTrigger}`. Hard-fails BEFORE any LLM/Jira call when
 * required dispatch fields are missing — surfaces the failure as a non-zero
 * exit + stderr line `MISSING_REQUIRED_DISPATCH_FIELD: <name>` so the Jira
 * automation rule can observe a deterministic failure mode.
 *
 * Two trigger sources:
 *   - `workflow_call`         → reads `inputs.ticket` only (status comes from Jira later).
 *   - `repository_dispatch`   → reads `client_payload.ticket` + `client_payload.status_at_trigger`.
 *
 * The `status_at_trigger` field is required for repository_dispatch so we can
 * skip downstream work when Jira changed status mid-flight (race protection
 * spec AC-1 + AC-19 + the Atlassian Automation rule contract).
 */

export interface GithubEventPayload {
  /** GITHUB_EVENT_NAME; one of "workflow_call" | "repository_dispatch". */
  eventName: string;
  /** Present for workflow_call (typed map of declared inputs). */
  inputs?: Record<string, unknown>;
  /** Present for repository_dispatch (free-form JSON object the dispatcher sent). */
  clientPayload?: Record<string, unknown>;
}

export interface ParsedDispatch {
  ticket: string;
  /** Null on workflow_call (status is fetched from Jira later); string on repository_dispatch. */
  statusAtTrigger: string | null;
}

export class MissingDispatchFieldError extends Error {
  readonly fieldName: string;

  constructor(fieldName: string) {
    super(`MISSING_REQUIRED_DISPATCH_FIELD: ${fieldName}`);
    this.name = "MissingDispatchFieldError";
    this.fieldName = fieldName;
  }
}

function requireField(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value === "") {
    throw new MissingDispatchFieldError(fieldName);
  }
  return value;
}

export function readDispatch(payload: GithubEventPayload): ParsedDispatch {
  if (payload.eventName === "workflow_call") {
    const inputs = payload.inputs ?? {};
    const ticket = requireField(inputs.ticket, "ticket");
    return { ticket, statusAtTrigger: null };
  }

  if (payload.eventName === "repository_dispatch") {
    const cp = payload.clientPayload ?? {};
    const ticket = requireField(cp.ticket, "ticket");
    const statusAtTrigger = requireField(cp.status_at_trigger, "status_at_trigger");
    return { ticket, statusAtTrigger };
  }

  throw new Error(
    `UNSUPPORTED_DISPATCH_EVENT: ${payload.eventName} (expected workflow_call or repository_dispatch)`,
  );
}

/**
 * CLI entry point — invoked by the workflow's first step.
 *
 * Reads `$ACCORD_DISPATCH_KIND` (preferred) or `$GITHUB_EVENT_NAME`
 * (fallback) and `$GITHUB_EVENT_PATH` (the JSON file GitHub Actions writes
 * for every workflow run), parses, validates, and emits the parsed
 * ticket/status to `$GITHUB_OUTPUT` for downstream steps. Errors are
 * printed to stderr and exit non-zero so the workflow fails fast.
 *
 * Why `ACCORD_DISPATCH_KIND` is preferred: inside a reusable workflow,
 * `GITHUB_EVENT_NAME` reflects the OUTER event (e.g. `workflow_dispatch`
 * for the maintainer smoke wrapper) and CANNOT be overridden via step
 * `env:` because `GITHUB_*` are runner-reserved. The workflow YAML
 * canonicalises the event kind into `ACCORD_DISPATCH_KIND` before
 * invoking this script — see `.github/workflows/autopipeline.yml`. The
 * fallback to `GITHUB_EVENT_NAME` preserves behaviour for repos that
 * call this script directly without the YAML canonicalisation step.
 */
async function main(): Promise<void> {
  const eventName = process.env.ACCORD_DISPATCH_KIND || process.env.GITHUB_EVENT_NAME;
  const eventPath = process.env.GITHUB_EVENT_PATH;

  if (!eventName) {
    process.stderr.write(
      "MISSING_REQUIRED_DISPATCH_FIELD: ACCORD_DISPATCH_KIND or GITHUB_EVENT_NAME\n",
    );
    process.exit(1);
  }
  if (!eventPath) {
    process.stderr.write("MISSING_REQUIRED_DISPATCH_FIELD: GITHUB_EVENT_PATH\n");
    process.exit(1);
  }

  const { readFile, appendFile } = await import("node:fs/promises");
  const raw = await readFile(eventPath, "utf8");
  const event = JSON.parse(raw) as Record<string, unknown>;

  const payload: GithubEventPayload = {
    eventName,
    inputs: (event.inputs as Record<string, unknown> | undefined) ?? undefined,
    clientPayload:
      (event.client_payload as Record<string, unknown> | undefined) ?? undefined,
  };

  try {
    const parsed = readDispatch(payload);
    const githubOutput = process.env.GITHUB_OUTPUT;
    if (githubOutput) {
      await appendFile(
        githubOutput,
        `ticket=${parsed.ticket}\nstatus_at_trigger=${parsed.statusAtTrigger ?? ""}\n`,
      );
    } else {
      process.stdout.write(
        `ticket=${parsed.ticket}\nstatus_at_trigger=${parsed.statusAtTrigger ?? ""}\n`,
      );
    }
  } catch (err) {
    if (err instanceof MissingDispatchFieldError) {
      process.stderr.write(`${err.message}\n`);
      process.exit(1);
    }
    process.stderr.write(`${(err as Error).message}\n`);
    process.exit(1);
  }
}

if (import.meta.main) {
  void main();
}
