/**
 * Slack HTTP client and shared types.
 * Pure functions — no pi dependency.
 */

import { getSlackAuth } from "../auth.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SlackSearchMatch {
  text: string;
  user: string;
  ts: string;
  channel: { id: string; name?: string };
  permalink: string;
}

export interface SlackSearchResponse {
  messages: { total: number; matches: SlackSearchMatch[] };
}

export interface SlackMessage {
  user?: string;
  bot_id?: string;
  text?: string;
  ts: string;
  subtype?: string;
  thread_ts?: string;
  reply_count?: number;
  replies?: unknown[];
}

export interface SlackChannel {
  id: string;
  name?: string;
  is_member?: boolean;
  is_im?: boolean;
  is_mpim?: boolean;
  is_private?: boolean;
}

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
}

export interface UnreadChannel {
  channelId: string;
  channelName: string;
  channelType: string;
  unreadCount: number;
  messages: Array<{
    user: string;
    text: string;
    ts: string;
    permalink: string;
    threadTs?: string;
    replyCount?: number;
  }>;
}

export interface UnansweredDM {
  channel: string;
  user: string;
  lastMessage: string;
  ts: string;
  permalink: string;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

export async function makeSlackRequest(
  endpoint: string,
  params?: Record<string, unknown>,
): Promise<any> {
  const auth = getSlackAuth();
  if (!auth) throw new Error("Slack not configured. Use /slack-setup first.");

  const url = new URL(`https://slack.com/api/${endpoint}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.append(key, String(value));
    }
  }

  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${auth.token}` },
  });

  if (!response.ok) {
    throw new Error(`Slack API HTTP error (${response.status})`);
  }

  const data = await response.json();
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error || "unknown"}`);
  }

  return data;
}

// ---------------------------------------------------------------------------
// Permalink helper
// ---------------------------------------------------------------------------

let _teamDomain: string | undefined;

export async function getTeamDomain(): Promise<string> {
  if (_teamDomain) return _teamDomain;
  try {
    const auth = await makeSlackRequest("auth.test");
    if (auth.url) {
      const match = auth.url.match(/https:\/\/([^.]+)\.slack\.com/);
      const domain = match?.[1];
      if (domain) {
        _teamDomain = domain;
        return domain;
      }
    }
    if (auth.team) {
      _teamDomain = auth.team as string;
      return _teamDomain;
    }
  } catch {
    /* fall through */
  }
  _teamDomain = "app";
  return _teamDomain;
}

export function makePermalink(teamDomain: string, channelId: string, ts: string): string {
  const tsNoDot = ts.replace(".", "");
  return `https://${teamDomain}.slack.com/archives/${channelId}/p${tsNoDot}`;
}
