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
function adfToText(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (node.type === "text") return node.text ?? "";
  if (Array.isArray(node.content)) return node.content.map(adfToText).join("");
  return "";
}

export const DETAIL_FIELDS =
  "summary,status,priority,issuetype,project,updated,assignee,description,comment";

export function mapDetailedIssue(issue: any): DetailedIssue {
  const f = issue.fields ?? {};
  const rawComments: any[] = f.comment?.comments ?? [];
  return {
    key: issue.key,
    summary: f.summary ?? "",
    status: f.status?.name ?? "",
    priority: f.priority?.name ?? "",
    type: f.issuetype?.name ?? "",
    project: f.project?.name ?? "",
    assignee: f.assignee?.displayName,
    updated: f.updated?.slice(0, 10) ?? "",
    description: adfToText(f.description)?.slice(0, 2000) || "(none)",
    comments: rawComments.slice(-10).map((c: any) => ({
      author: c.author?.displayName ?? "unknown",
      created: c.created?.slice(0, 10) ?? "",
      body: adfToText(c.body)?.slice(0, 500) || "",
    })),
  };
}
