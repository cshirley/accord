import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  type FetchLike,
  postComment,
  transitionTicket,
  truncateForJira,
} from "../src/jira-comment.js";

const ENV_BACKUP: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of [
    "JIRA_BASE_URL",
    "JIRA_USER_EMAIL",
    "JIRA_API_TOKEN",
    "DRY_RUN",
    "JIRA_DRY_RUN_LOG",
  ]) {
    ENV_BACKUP[k] = process.env[k];
    delete process.env[k];
  }
  process.env.JIRA_BASE_URL = "https://example.atlassian.net";
  process.env.JIRA_USER_EMAIL = "user@example.com";
  process.env.JIRA_API_TOKEN = "test-api-token";
});

afterEach(() => {
  for (const [k, v] of Object.entries(ENV_BACKUP)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string;
}

function makeFetch(
  responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> }>,
): {
  fetch: FetchLike;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let i = 0;
  const fetch: FetchLike = async (url, init) => {
    const headers: Record<string, string> = {};
    const initHeaders = (init?.headers ?? {}) as Record<string, string>;
    for (const k of Object.keys(initHeaders)) {
      headers[k.toLowerCase()] = initHeaders[k] as string;
    }
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : "",
    });
    const r = responses[i++];
    if (!r) throw new Error("ran out of stubbed responses");
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      headers: {
        get: (h: string) => (r.headers ? (r.headers[h.toLowerCase()] ?? null) : null),
      },
      text: async () => (typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {})),
      json: async () => r.body ?? {},
    } as Awaited<ReturnType<FetchLike>>;
  };
  return { fetch, calls };
}

describe("postComment — request shape", () => {
  test("POSTs to the canonical Jira REST URL", async () => {
    const { fetch, calls } = makeFetch([{ status: 201, body: { id: "10000" } }]);
    await postComment({ ticket: "PROJ-1", body: "hello" }, { fetch });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://example.atlassian.net/rest/api/3/issue/PROJ-1/comment");
    expect(calls[0].method).toBe("POST");
  });

  test("uses HTTP basic auth with email:token (base64-encoded)", async () => {
    const { fetch, calls } = makeFetch([{ status: 201 }]);
    await postComment({ ticket: "PROJ-1", body: "hello" }, { fetch });
    const auth = calls[0].headers.authorization;
    expect(auth.startsWith("Basic ")).toBe(true);
    const decoded = Buffer.from(auth.slice(6), "base64").toString("utf8");
    expect(decoded).toBe("user@example.com:test-api-token");
  });

  test("sends the body as JSON with `application/json` content-type", async () => {
    const { fetch, calls } = makeFetch([{ status: 201 }]);
    await postComment({ ticket: "PROJ-1", body: "hello" }, { fetch });
    expect(calls[0].headers["content-type"]).toBe("application/json");
    const parsed = JSON.parse(calls[0].body);
    expect(parsed.body).toBeDefined();
  });
});

describe("postComment — 429 retry behaviour", () => {
  test("retries ONCE on HTTP 429 with the Retry-After delay (then succeeds)", async () => {
    const { fetch, calls } = makeFetch([
      { status: 429, headers: { "retry-after": "1" } },
      { status: 201 },
    ]);
    const start = Date.now();
    await postComment({ ticket: "PROJ-1", body: "hello" }, { fetch });
    const elapsed = Date.now() - start;
    expect(calls).toHaveLength(2);
    expect(elapsed).toBeGreaterThanOrEqual(900);
  });

  test("Retry-After is capped at the documented ceiling (no DoS via header)", async () => {
    const { fetch, calls } = makeFetch([
      { status: 429, headers: { "retry-after": "999999" } },
      { status: 201 },
    ]);
    const start = Date.now();
    await postComment({ ticket: "PROJ-1", body: "hello" }, { fetch, maxRetryDelayMs: 50 });
    const elapsed = Date.now() - start;
    expect(calls).toHaveLength(2);
    expect(elapsed).toBeLessThan(500);
  });

  test("fails after one retry when the server keeps returning 429", async () => {
    const { fetch } = makeFetch([
      { status: 429, headers: { "retry-after": "0" } },
      { status: 429, headers: { "retry-after": "0" } },
    ]);
    await expect(
      postComment({ ticket: "PROJ-1", body: "hello" }, { fetch, maxRetryDelayMs: 10 }),
    ).rejects.toThrow();
  });
});

describe("postComment — DRY_RUN", () => {
  test("DRY_RUN=1 → no HTTP call; the comment is appended to JIRA_DRY_RUN_LOG", async () => {
    const dryRunDir = mkdtempSync(join(tmpdir(), "accord-jira-dry-"));
    process.env.DRY_RUN = "1";
    process.env.JIRA_DRY_RUN_LOG = join(dryRunDir, "jira-log.jsonl");

    let calledFetch = false;
    const fetch: FetchLike = async () => {
      calledFetch = true;
      throw new Error("fetch must not be called in DRY_RUN");
    };

    try {
      await postComment({ ticket: "PROJ-1", body: "hello dry-run" }, { fetch });
      expect(calledFetch).toBe(false);
      const log = readFileSync(process.env.JIRA_DRY_RUN_LOG, "utf8").trim();
      const entry = JSON.parse(log);
      expect(entry.action).toBe("postComment");
      expect(entry.ticket).toBe("PROJ-1");
      expect(entry.body).toContain("hello dry-run");
    } finally {
      rmSync(dryRunDir, { recursive: true, force: true });
    }
  });
});

describe("postComment — secret-value never logged on error", () => {
  test("network error message does NOT contain the API token", async () => {
    const fetch: FetchLike = async () => {
      throw new Error("ECONNREFUSED");
    };
    let err: Error | null = null;
    try {
      await postComment({ ticket: "PROJ-1", body: "hello" }, { fetch });
    } catch (e) {
      err = e as Error;
    }
    expect(err).not.toBeNull();
    expect(err?.message).not.toContain("test-api-token");
    expect(err?.message).not.toContain("Basic ");
  });
});

describe("transitionTicket", () => {
  test("resolves the target transition by name and POSTs to .../transitions", async () => {
    const { fetch, calls } = makeFetch([
      {
        status: 200,
        body: {
          transitions: [
            { id: "11", name: "In Progress" },
            { id: "31", name: "Needs Triage" },
            { id: "41", name: "Done" },
          ],
        },
      },
      { status: 204 },
    ]);
    await transitionTicket({ ticket: "PROJ-1", target: "Needs Triage" }, { fetch });
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain("/issue/PROJ-1/transitions");
    expect(calls[0].method).toBe("GET");
    expect(calls[1].method).toBe("POST");
    const posted = JSON.parse(calls[1].body);
    expect(posted.transition.id).toBe("31");
  });

  test("throws a clear error when the target transition name is unknown", async () => {
    const { fetch } = makeFetch([
      { status: 200, body: { transitions: [{ id: "11", name: "Other" }] } },
    ]);
    await expect(transitionTicket({ ticket: "PROJ-1", target: "Nope" }, { fetch })).rejects.toThrow(
      /Nope/,
    );
  });
});

describe("truncateForJira", () => {
  test("returns input unchanged when under the limit", () => {
    expect(truncateForJira("short", 100)).toBe("short");
  });

  test("truncates at the byte limit and appends a continuation suffix", () => {
    const long = "a".repeat(1000);
    const out = truncateForJira(long, 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out).toContain("[truncated]");
  });

  test("never returns more bytes than the configured maxBytes", () => {
    const long = "x".repeat(10000);
    const out = truncateForJira(long, 200);
    expect(Buffer.byteLength(out, "utf8")).toBeLessThanOrEqual(200);
  });
});
