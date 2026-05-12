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
