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
  reactions?: Array<{ users?: string[] }>;
}

export interface SlackChannel {
  id: string;
  name?: string;
  is_member?: boolean;
  is_im?: boolean;
  is_mpim?: boolean;
  is_private?: boolean;
}

/** `conversations.list` API shape (subset). */
export type SlackConversationsListResult = {
  channels?: SlackChannel[];
  response_metadata?: { next_cursor?: string };
};

/** `conversations.info` API shape (subset). */
export type SlackConversationsInfoResult = {
  channel?: { last_read?: string };
};

/** `conversations.history` / `conversations.replies` API shape (subset). */
export type SlackConversationsHistoryResult = {
  messages?: SlackMessage[];
};

/** `users.info` / `users.lookupByEmail` API shape (subset). */
export type SlackUsersInfoResult = {
  user?: {
    id?: string;
    profile?: {
      display_name?: string;
      real_name?: string;
      email?: string;
      title?: string;
      status_text?: string;
    };
    real_name?: string;
    name?: string;
  };
};

/** `users.list` API shape (subset). */
export type SlackUser = {
  id: string;
  name?: string;
  real_name?: string;
  deleted?: boolean;
  is_bot?: boolean;
  profile?: { display_name?: string; real_name?: string; email?: string };
};

export type SlackUsersListResult = {
  members?: SlackUser[];
  response_metadata?: { next_cursor?: string };
};

/** `chat.postMessage` API shape (subset). */
export type SlackPostMessageResult = {
  channel: string;
  ts: string;
};

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

export async function makeSlackRequest<T = Record<string, unknown>>(
  endpoint: string,
  params?: Record<string, unknown>,
): Promise<T> {
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

  const data = (await response.json()) as Record<string, unknown> & { ok: boolean; error?: string };
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error || "unknown"}`);
  }

  return data as T;
}

// ---------------------------------------------------------------------------
// Permalink helper
// ---------------------------------------------------------------------------

let _teamDomain: string | undefined;

export async function getTeamDomain(): Promise<string> {
  if (_teamDomain) return _teamDomain;
  try {
    const auth = await makeSlackRequest<{ url?: string; team?: string }>("auth.test");
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

// ---------------------------------------------------------------------------
// Write helper (POST with JSON body — for chat.postMessage, conversations.open)
// ---------------------------------------------------------------------------

export async function makeSlackPostRequest<T = Record<string, unknown>>(
  endpoint: string,
  body: Record<string, unknown>,
): Promise<T> {
  const auth = getSlackAuth();
  if (!auth) throw new Error("Slack not configured. Use /slack-setup first.");

  const response = await fetch(`https://slack.com/api/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Slack API HTTP error (${response.status})`);
  }

  const data = (await response.json()) as Record<string, unknown> & { ok: boolean; error?: string };
  if (!data.ok) {
    throw new Error(`Slack API error: ${data.error || "unknown"}`);
  }
  return data as T;
}

// ---------------------------------------------------------------------------
// User + channel resolution
// ---------------------------------------------------------------------------

const SLACK_ID_RE = /^[CGD][A-Z0-9]{6,}$/;
const SLACK_USER_ID_RE = /^[UW][A-Z0-9]{6,}$/;

let _workspaceUsers: SlackUser[] | undefined;

async function loadWorkspaceUsers(): Promise<SlackUser[]> {
  if (_workspaceUsers) return _workspaceUsers;
  const all: SlackUser[] = [];
  let cursor: string | undefined;
  do {
    const resp = await makeSlackRequest<SlackUsersListResult>("users.list", {
      limit: 200,
      ...(cursor ? { cursor } : {}),
    });
    if (resp.members) all.push(...resp.members);
    cursor = resp.response_metadata?.next_cursor || undefined;
  } while (cursor);
  _workspaceUsers = all;
  return all;
}

function looksLikeEmail(value: string): boolean {
  return value.includes("@") && value.includes(".");
}

/**
 * Resolve a Slack user reference to a user ID. Accepts:
 *   • user IDs (U…/W…, optionally @-prefixed) — returned as-is
 *   • emails — resolved via users.lookupByEmail
 *   • display name / real name / handle — matched against users.list
 */
export async function resolveUserId(query: string): Promise<string> {
  const q = query.trim().replace(/^@/, "");
  if (SLACK_USER_ID_RE.test(q)) return q;

  if (looksLikeEmail(q)) {
    try {
      const resp = await makeSlackRequest<SlackUsersInfoResult>("users.lookupByEmail", {
        email: q,
      });
      if (resp.user?.id) return resp.user.id;
    } catch {
      /* fall through to name scan */
    }
  }

  const members = await loadWorkspaceUsers();
  const lower = q.toLowerCase();
  const match = members.find((m) => {
    if (m.deleted) return false;
    return (
      m.profile?.display_name?.toLowerCase() === lower ||
      (m.profile?.real_name || m.real_name)?.toLowerCase() === lower ||
      m.name?.toLowerCase() === lower ||
      m.profile?.email?.toLowerCase() === lower
    );
  });
  if (match?.id) return match.id;

  throw new Error(
    `No Slack user matching "${query}" (try a user ID, email, or exact display name)`,
  );
}

/**
 * Resolve a user-supplied target to a conversation ID:
 *   • channel / group / DM IDs (C…, G…, D…) are used as-is
 *   • user IDs, @display-names, or emails open a DM via conversations.open
 *   • #channel-name is looked up against conversations.list (paginated)
 */
export async function resolveSlackChannelId(rawTarget: string): Promise<string> {
  const target = rawTarget.trim();
  if (SLACK_ID_RE.test(target)) return target;

  const maybeUser = target.replace(/^@/, "");
  const isUserRef =
    target.startsWith("@") || SLACK_USER_ID_RE.test(maybeUser) || looksLikeEmail(maybeUser);
  if (isUserRef) {
    const userId = await resolveUserId(maybeUser);
    const opened = await makeSlackPostRequest<{ channel?: { id?: string } }>("conversations.open", {
      users: userId,
    });
    const id = opened.channel?.id;
    if (!id) throw new Error(`Could not open a DM with ${maybeUser}`);
    return id;
  }

  const name = target.replace(/^#/, "").toLowerCase();
  let cursor: string | undefined;
  do {
    const resp = await makeSlackRequest<SlackConversationsListResult>("conversations.list", {
      limit: 1000,
      exclude_archived: true,
      types: "public_channel,private_channel",
      ...(cursor ? { cursor } : {}),
    });
    const match = resp.channels?.find((c) => c.name?.toLowerCase() === name);
    if (match?.id) return match.id;
    cursor = resp.response_metadata?.next_cursor || undefined;
  } while (cursor);

  throw new Error(`Channel #${name} not found (is the token a member of it?)`);
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export interface SendSlackMessageInput {
  /** Channel ID, #channel-name, user ID, @display-name, or email. */
  target: string;
  /** Message body (Slack mrkdwn). */
  text: string;
  /** Optional parent message ts to reply in-thread. */
  threadTs?: string;
  /** Whether to render mrkdwn (default true). */
  mrkdwn?: boolean;
}

export interface SendSlackMessageResult {
  channel: string;
  ts: string;
  permalink: string;
}

export async function sendSlackMessage(
  input: SendSlackMessageInput,
): Promise<SendSlackMessageResult> {
  const channel = await resolveSlackChannelId(input.target);
  const result = await makeSlackPostRequest<SlackPostMessageResult>("chat.postMessage", {
    channel,
    text: input.text,
    mrkdwn: input.mrkdwn ?? true,
    ...(input.threadTs ? { thread_ts: input.threadTs } : {}),
  });
  const domain = await getTeamDomain().catch(() => "app");
  return {
    channel: result.channel,
    ts: result.ts,
    permalink: makePermalink(domain, result.channel, result.ts),
  };
}
