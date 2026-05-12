/**
 * Terminal Jira REST helper used by the autopipeline workflow ONLY at
 * terminal entry points (after a phase return packet has been classified
 * by `parse-phase-result.ts`). Mid-phase callers are prohibited — the
 * `tests/ci/no-extra-pi-spawns.test.ts` enforcement pattern is extended in
 * task 11 to also assert this.
 *
 * Auth: HTTP basic with `JIRA_USER_EMAIL` + `JIRA_API_TOKEN` (Jira Cloud
 * REST API v3). Throws `MissingSecretError` if either is missing.
 *
 * Retry: ONE retry on HTTP 429 with `Retry-After`, capped at a configurable
 * ceiling so a hostile / misconfigured server cannot stall the workflow
 * past the `inputs.max_runtime_minutes` budget.
 *
 * Dry-run: when `DRY_RUN=1`, ALL HTTP calls are short-circuited and
 * appended as JSONL to `JIRA_DRY_RUN_LOG` (defaults to
 * `tests/ci/.tmp/jira-log.jsonl`). The self-test workflow (task 12) byte-
 * compares this log against goldens.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { requireEnv } from "./lib/env.js";

export type FetchLike = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  },
) => Promise<{
  ok: boolean;
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
  json(): Promise<unknown>;
}>;

const DEFAULT_MAX_RETRY_DELAY_MS = 5000;
const DEFAULT_DRY_RUN_LOG = "tests/ci/.tmp/jira-log.jsonl";

function basicAuthHeader(): string {
  const email = requireEnv("JIRA_USER_EMAIL");
  const token = requireEnv("JIRA_API_TOKEN");
  return `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
}

function dryRunActive(): boolean {
  return process.env.DRY_RUN === "1";
}

function appendDryRunLog(entry: Record<string, unknown>): void {
  const path = process.env.JIRA_DRY_RUN_LOG || DEFAULT_DRY_RUN_LOG;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function sanitiseError(err: unknown): Error {
  if (err instanceof Error) {
    // Strip Authorization header / secret values from messages.
    let msg = err.message;
    const token = process.env.JIRA_API_TOKEN;
    if (token) msg = msg.split(token).join("[redacted]");
    msg = msg.replace(/Basic [A-Za-z0-9+/=]+/g, "Basic [redacted]");
    return new Error(msg);
  }
  return new Error(String(err));
}

export interface PostCommentOpts {
  readonly ticket: string;
  readonly body: string;
}

export interface PostCommentExtra {
  readonly fetch?: FetchLike;
  readonly maxRetryDelayMs?: number;
}

const defaultFetch: FetchLike = globalThis.fetch as unknown as FetchLike;

async function jiraRequest(
  url: string,
  method: "GET" | "POST",
  body: string | undefined,
  opts: { fetch?: FetchLike; maxRetryDelayMs?: number } = {},
): Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
  text: () => Promise<string>;
}> {
  const fetch = opts.fetch ?? defaultFetch;
  const maxRetryDelayMs = opts.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
  const headers: Record<string, string> = {
    Authorization: basicAuthHeader(),
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetch(url, { method, headers, body });
  } catch (err) {
    throw sanitiseError(err);
  }
  if (res.status === 429) {
    const retryAfter = Number.parseInt(res.headers.get("retry-after") ?? "0", 10);
    const rawDelay = Number.isFinite(retryAfter) ? retryAfter * 1000 : 0;
    const delayMs = Math.min(Math.max(rawDelay, 0), maxRetryDelayMs);
    await sleep(delayMs);
    try {
      res = await fetch(url, { method, headers, body });
    } catch (err) {
      throw sanitiseError(err);
    }
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira request to ${url} failed: HTTP ${res.status} — ${text.slice(0, 500)}`);
  }
  return res;
}

export async function postComment(
  opts: PostCommentOpts,
  extra: PostCommentExtra = {},
): Promise<void> {
  if (dryRunActive()) {
    appendDryRunLog({ action: "postComment", ticket: opts.ticket, body: opts.body });
    return;
  }
  const baseUrl = requireEnv("JIRA_BASE_URL").replace(/\/+$/, "");
  const url = `${baseUrl}/rest/api/3/issue/${encodeURIComponent(opts.ticket)}/comment`;
  // Jira Cloud accepts comment body as plain text under `body` (legacy) or
  // ADF (`body: { type: 'doc', version: 1, content: [...] }`). For v1 we
  // send a minimal ADF doc with a single paragraph carrying the rendered text.
  const adf = {
    type: "doc",
    version: 1,
    content: [{ type: "paragraph", content: [{ type: "text", text: opts.body }] }],
  };
  await jiraRequest(url, "POST", JSON.stringify({ body: adf }), {
    fetch: extra.fetch,
    maxRetryDelayMs: extra.maxRetryDelayMs,
  });
}

export interface TransitionOpts {
  readonly ticket: string;
  readonly target: string;
}

export async function transitionTicket(
  opts: TransitionOpts,
  extra: PostCommentExtra = {},
): Promise<void> {
  if (dryRunActive()) {
    appendDryRunLog({ action: "transitionTicket", ticket: opts.ticket, target: opts.target });
    return;
  }
  const baseUrl = requireEnv("JIRA_BASE_URL").replace(/\/+$/, "");
  const url = `${baseUrl}/rest/api/3/issue/${encodeURIComponent(opts.ticket)}/transitions`;
  const list = await jiraRequest(url, "GET", undefined, extra);
  const body = (await list.json()) as { transitions?: Array<{ id: string; name: string }> };
  const match = body.transitions?.find((t) => t.name === opts.target);
  if (!match) {
    throw new Error(
      `Jira transition "${opts.target}" not available on ${opts.ticket}. ` +
        `Available: ${body.transitions?.map((t) => t.name).join(", ") ?? "(none)"}.`,
    );
  }
  await jiraRequest(url, "POST", JSON.stringify({ transition: { id: match.id } }), extra);
}

const TRUNCATION_SUFFIX = "\n\n[truncated]";

export function truncateForJira(body: string, maxBytes: number): string {
  if (Buffer.byteLength(body, "utf8") <= maxBytes) return body;
  const suffixBytes = Buffer.byteLength(TRUNCATION_SUFFIX, "utf8");
  const targetBytes = Math.max(0, maxBytes - suffixBytes);
  const slice = Buffer.from(body, "utf8").subarray(0, targetBytes).toString("utf8");
  return slice + TRUNCATION_SUFFIX;
}
