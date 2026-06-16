/**
 * Jira HTTP client and shared types.
 * Pure functions — no pi dependency.
 */

import { createBasicAuthHeader, getJiraAuth } from "../auth.js";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export const DEFAULT_CLOUD_ID =
  process.env.ATLASSIAN_CLOUD_ID ?? "33ab726a-af2c-42a0-a6cf-17182f6e6a5f";

export const DEFAULT_FIELDS = "summary,status,priority,issuetype,project,updated,assignee";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JiraIssue {
  key: string;
  fields: {
    summary: string;
    status: { name: string };
    priority: { name: string };
    updated: string;
    assignee?: { displayName: string; emailAddress: string };
    issuetype: { name: string };
    project: { name: string; key: string };
  };
}

export interface JiraSearchResponse {
  issues: JiraIssue[];
  isLast?: boolean;
  nextPageToken?: string;
  total?: number;
  maxResults?: number;
}

export interface MappedIssue {
  key: string;
  summary: string;
  status: string;
  updated: string;
}

export interface DetailedIssue extends MappedIssue {
  priority: string;
  type: string;
  project: string;
  assignee: string | undefined;
  description: string;
  comments: { author: string; created: string; body: string }[];
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

export async function makeJiraRequest(
  endpoint: string,
  params?: Record<string, string | number>,
): Promise<unknown> {
  const auth = getJiraAuth();
  if (!auth) throw new Error("Jira not configured. Use /jira-setup first.");

  const url = new URL(`${auth.baseUrl}/rest/api/3/${endpoint}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.append(key, String(value));
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: createBasicAuthHeader(auth.email, auth.apiToken),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Jira API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

export function mapIssue(issue: JiraIssue): MappedIssue {
  return {
    key: issue.key,
    summary: issue.fields?.summary ?? "",
    status: issue.fields?.status?.name ?? "",
    updated: issue.fields?.updated?.slice(0, 10) ?? "",
  };
}

/** Extract plain text from ADF (Atlassian Document Format) node tree. */
function adfToText(node: unknown): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  const n = node as Record<string, unknown>;
  if (n.type === "text") return String(n.text ?? "");
  if (Array.isArray(n.content)) return (n.content as unknown[]).map(adfToText).join("");
  return "";
}

export const DETAIL_FIELDS =
  "summary,status,priority,issuetype,project,updated,assignee,description,comment";

// ---------------------------------------------------------------------------
// Field metadata + custom-field retrieval (e.g. CRQ change requests)
// ---------------------------------------------------------------------------

export interface JiraField {
  id: string;
  name: string;
  custom?: boolean;
  schema?: { type?: string };
}

let _fieldCache: JiraField[] | undefined;

/** Fetch (and cache) the full Jira field catalogue (system + custom). */
export async function loadJiraFields(): Promise<JiraField[]> {
  if (_fieldCache) return _fieldCache;
  const raw = (await makeJiraRequest("field")) as JiraField[];
  _fieldCache = Array.isArray(raw) ? raw : [];
  return _fieldCache;
}

export interface ResolvedField {
  requested: string;
  id: string;
  name: string;
}

/**
 * Map human field names (or raw IDs) to Jira field IDs. Exact-case-insensitive
 * match on id first, then name; unknown inputs pass through unchanged so callers
 * can still supply a literal `customfield_xxxxx`.
 */
export async function resolveFieldIds(names: string[]): Promise<ResolvedField[]> {
  const fields = await loadJiraFields();
  const byId = new Map(fields.map((f) => [f.id.toLowerCase(), f]));
  const byName = new Map(fields.map((f) => [f.name.toLowerCase(), f]));
  return names.map((requested) => {
    const key = requested.trim();
    const lower = key.toLowerCase();
    const hit = byId.get(lower) ?? byName.get(lower);
    return hit ? { requested, id: hit.id, name: hit.name } : { requested, id: key, name: key };
  });
}

/** Best-effort flatten of any Jira field value (ADF, options, users, arrays) to text. */
export function flattenFieldValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(flattenFieldValue).filter(Boolean).join(", ");

  const o = value as Record<string, unknown>;
  if (o.type === "doc" || Array.isArray(o.content)) {
    const txt = adfToText(o);
    if (txt) return txt;
  }
  if (typeof o.value === "string") return o.value; // select / option
  if (typeof o.name === "string") return o.name; // status / priority / component
  if (typeof o.displayName === "string") return o.displayName; // user
  if (typeof o.emailAddress === "string") return o.emailAddress;
  if (typeof o.key === "string") return o.key; // project / version
  return JSON.stringify(value);
}

export interface IssueFieldValue {
  id: string;
  name: string;
  value: string;
  raw: unknown;
}

export interface IssueWithFields {
  key: string;
  summary: string;
  status: string;
  fields: IssueFieldValue[];
}

/**
 * Fetch a single issue returning only the requested fields (names or IDs),
 * with custom-field names resolved to IDs. summary + status are always included
 * for context. Used for CRQ / change-request retrieval where the caller knows
 * the field labels but not the customfield IDs.
 */
export async function getIssueWithFields(
  issueKey: string,
  requestedFields: string[],
): Promise<IssueWithFields> {
  const resolved = await resolveFieldIds(requestedFields);
  const ids = Array.from(new Set(["summary", "status", ...resolved.map((r) => r.id)]));
  const issue = (await makeJiraRequest(`issue/${issueKey}`, { fields: ids.join(",") })) as {
    key?: string;
    fields?: Record<string, unknown>;
  };
  const f = issue.fields ?? {};
  return {
    key: String(issue.key ?? issueKey),
    summary: String((f.summary as string | undefined) ?? ""),
    status: String((f.status as { name?: string } | undefined)?.name ?? ""),
    fields: resolved.map((r) => ({
      id: r.id,
      name: r.name,
      value: flattenFieldValue(f[r.id]),
      raw: f[r.id] ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------
// CRQ linked-change manifest (release notifications)
// ---------------------------------------------------------------------------

export interface CrqLinkedIssue {
  key: string;
  summary: string;
  status: string;
  statusCategory: string;
  /** True when the ticket is release-ready by status alone (Done / Ready for Release / done category). */
  statusDone: boolean;
  issueType: string;
  /** Assignee display name + email (for Slack-handle resolution via email lookup). */
  assignee?: string;
  assigneeEmail?: string;
}

export interface CrqChangeManifest {
  key: string;
  summary: string;
  status: string;
  /** CRQ assignee display name. */
  owner: string;
  /** First non-empty Rollback/Backout plan field value (flattened). */
  rollbackPlan: string;
  /** Service name derived from the CRQ summary prefix (before " - "). */
  service: string;
  /** GitHub repo the changes live in: `emed-labs/<service>`. */
  repo: string;
  jiraUrl: string;
  issues: CrqLinkedIssue[];
}

const DONE_STATUS_NAMES = new Set(["done", "ready for release", "released", "closed"]);

/** Status-only release-readiness: explicit Done/Ready-for-Release names or the "done" category. */
export function isReleaseReadyStatus(name: string, categoryKey: string): boolean {
  return DONE_STATUS_NAMES.has(name.trim().toLowerCase()) || categoryKey.toLowerCase() === "done";
}

/**
 * Fetch a CRQ and return its linked changes (Jira issue links), excluding sibling
 * CRQ tickets. Each entry carries status + a `statusDone` flag; the caller layers
 * on PR labels/author from GitHub. `service`/`repo` are derived from the CRQ summary
 * (e.g. "platform-integrations - 2026-06-15_002" -> repo `emed-labs/platform-integrations`).
 */
export async function getCrqLinkedIssues(crqKey: string): Promise<CrqChangeManifest> {
  const auth = getJiraAuth();
  const baseUrl = auth?.baseUrl ?? "https://babylonpartners.atlassian.net";

  // Resolve Rollback/Backout plan field IDs (there are several config variants;
  // names collide, so we collect every matching ID and pick the first populated one).
  const catalogue = await loadJiraFields();
  const rollbackFieldIds = catalogue
    .filter((f) => /roll\s?back|back\s?out/i.test(f.name))
    .map((f) => f.id);

  const fieldList = ["summary", "status", "assignee", "issuelinks", ...rollbackFieldIds].join(",");
  const issue = (await makeJiraRequest(`issue/${crqKey}`, { fields: fieldList })) as {
    key?: string;
    fields?: Record<string, unknown>;
  };
  const f0 = issue.fields ?? {};
  const key = String(issue.key ?? crqKey);
  const summary = String((f0.summary as string | undefined) ?? "");
  const status = String((f0.status as { name?: string } | undefined)?.name ?? "");
  const owner = String((f0.assignee as { displayName?: string } | undefined)?.displayName ?? "");
  const rollbackPlan =
    rollbackFieldIds.map((id) => flattenFieldValue(f0[id])).find((v) => v.trim().length > 0) ?? "";
  const service = summary.split(" - ")[0]?.trim() ?? "";
  const links = Array.isArray(f0.issuelinks) ? (f0.issuelinks as unknown[]) : [];

  const issues: CrqLinkedIssue[] = [];
  for (const raw of links) {
    const link = raw as { inwardIssue?: unknown; outwardIssue?: unknown };
    const li = (link.inwardIssue ?? link.outwardIssue) as
      | { key?: string; fields?: Record<string, unknown> }
      | undefined;
    if (!li?.key || /^CRQ-/i.test(li.key)) continue; // drop sibling change requests
    const f = li.fields ?? {};
    const status = f.status as { name?: string; statusCategory?: { key?: string } } | undefined;
    const statusName = String(status?.name ?? "");
    const categoryKey = String(status?.statusCategory?.key ?? "");
    issues.push({
      key: li.key,
      summary: String((f.summary as string | undefined) ?? ""),
      status: statusName,
      statusCategory: categoryKey,
      statusDone: isReleaseReadyStatus(statusName, categoryKey),
      issueType: String((f.issuetype as { name?: string } | undefined)?.name ?? ""),
    });
  }

  // Enrich with assignee (display name + email) in one bulk query — issuelinks
  // don't carry assignee. Best-effort: a failure here leaves assignee undefined.
  if (issues.length > 0) {
    try {
      const jql = `key in (${issues.map((i) => i.key).join(",")})`;
      const resp = (await makeJiraRequest("search/jql", {
        jql,
        fields: "assignee",
        maxResults: issues.length,
      })) as JiraSearchResponse;
      const byKey = new Map(
        (resp.issues ?? []).map((iss) => {
          const a = (iss.fields as { assignee?: { displayName?: string; emailAddress?: string } })
            ?.assignee;
          return [iss.key, a] as const;
        }),
      );
      for (const issue of issues) {
        const a = byKey.get(issue.key);
        if (a) {
          issue.assignee = a.displayName;
          issue.assigneeEmail = a.emailAddress;
        }
      }
    } catch {
      // leave assignee fields undefined
    }
  }

  return {
    key,
    summary,
    status,
    owner,
    rollbackPlan,
    service,
    repo: service ? `emed-labs/${service}` : "",
    jiraUrl: `${baseUrl}/browse/${key}`,
    issues,
  };
}

export function mapDetailedIssue(issue: unknown): DetailedIssue {
  const i = issue as { key?: string; fields?: Record<string, unknown> };
  const f = i.fields ?? {};
  const commentBlock = f.comment as { comments?: unknown[] } | undefined;
  const rawComments: unknown[] = commentBlock?.comments ?? [];
  return {
    key: String(i.key ?? ""),
    summary: String(f.summary ?? ""),
    status: String((f.status as { name?: string } | undefined)?.name ?? ""),
    priority: String((f.priority as { name?: string } | undefined)?.name ?? ""),
    type: String((f.issuetype as { name?: string } | undefined)?.name ?? ""),
    project: String((f.project as { name?: string } | undefined)?.name ?? ""),
    assignee: (f.assignee as { displayName?: string } | undefined)?.displayName,
    updated: String((f.updated as string | undefined)?.slice(0, 10) ?? ""),
    description: adfToText(f.description)?.slice(0, 2000) || "(none)",
    comments: rawComments.slice(-10).map((c) => {
      const comment = c as Record<string, unknown>;
      return {
        author: String(
          (comment.author as { displayName?: string } | undefined)?.displayName ?? "unknown",
        ),
        created: String((comment.created as string | undefined)?.slice(0, 10) ?? ""),
        body: adfToText(comment.body)?.slice(0, 500) || "",
      };
    }),
  };
}
