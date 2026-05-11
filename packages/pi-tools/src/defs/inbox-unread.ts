/**
 * Unified Inbox — surfaces unread/unactioned items from Slack and Gmail
 * in a single prioritised view.
 *
 * Runs Slack unread scan + Gmail unread search in parallel, then merges
 * and sorts by timestamp descending.
 */

import { defineTool, getMcpRegistry, mcpText } from "../framework.js";
import { getSlackAuth } from "../auth.js";
import {
  makeSlackRequest, getTeamDomain, makePermalink,
  type UnreadChannel,
} from "../services/slack.client.js";
import {
  makeGoogleRequest, hasNativeGoogleAuth, headerValue,
  type GmailHeader, type GmailMessageSummary,
} from "../services/google.client.js";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

interface InboxItem {
  source: "slack" | "gmail";
  /** ISO-ish date or Unix ts for sorting */
  timestamp: number;
  from: string;
  subject: string;
  snippet: string;
  permalink: string;
  /** slack channel type or gmail label category */
  category: string;
  /** true if likely needs a response/action */
  actionable: boolean;
  meta?: Record<string, unknown>;
}

interface InboxResult {
  slackTotal: number;
  gmailTotal: number;
  items: InboxItem[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slackTsToEpoch(ts: string): number {
  return Math.floor(parseFloat(ts) * 1000);
}

function parseDateToEpoch(dateStr: string): number {
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

function extractCategory(labelIds: string[]): string {
  const cat = labelIds.find((l) => l.startsWith("CATEGORY_"));
  if (cat) return cat.replace("CATEGORY_", "").toLowerCase();
  if (labelIds.includes("INBOX")) return "inbox";
  return "other";
}

function isActionableEmail(msg: GmailMessageSummary, labelIds: string[]): boolean {
  const important = labelIds.includes("IMPORTANT");
  const inbox = labelIds.includes("INBOX");
  // Skip purely automated/newsletter unless marked important
  const from = msg.from.toLowerCase();
  const isBot = from.includes("noreply") || from.includes("no-reply")
    || from.includes("notifications@") || from.includes("mailer-daemon");
  if (isBot && !important) return false;
  return inbox;
}

// ---------------------------------------------------------------------------
// Slack fetcher
// ---------------------------------------------------------------------------

async function fetchSlackUnread(
  maxChannels: number,
  maxPerChannel: number,
): Promise<{ total: number; items: InboxItem[] }> {
  if (!getSlackAuth()) return { total: 0, items: [] };

  const teamDomain = await getTeamDomain();
  const types = "public_channel,private_channel,mpim,im";

  let allChannels: any[] = [];
  let cursor: string | undefined;
  do {
    const resp = await makeSlackRequest("conversations.list", {
      types, limit: Math.min(maxChannels - allChannels.length, 200),
      exclude_archived: true,
      ...(cursor ? { cursor } : {}),
    });
    allChannels.push(...(resp.channels || []));
    cursor = resp.response_metadata?.next_cursor || undefined;
  } while (cursor && allChannels.length < maxChannels);

  const memberChannels = allChannels.filter(
    (ch: any) => ch.is_member || ch.is_im || ch.is_mpim,
  );

  const items: InboxItem[] = [];

  // Resolve user names in bulk (best effort)
  const userCache = new Map<string, string>();
  async function userName(uid: string): Promise<string> {
    if (!uid || uid === "unknown") return uid;
    if (userCache.has(uid)) return userCache.get(uid)!;
    try {
      const info = await makeSlackRequest("users.info", { user: uid });
      const name = info.user?.profile?.display_name
        || info.user?.profile?.real_name
        || info.user?.name
        || uid;
      userCache.set(uid, name);
      return name;
    } catch {
      userCache.set(uid, uid);
      return uid;
    }
  }

  for (const ch of memberChannels) {
    try {
      const info = await makeSlackRequest("conversations.info", { channel: ch.id });
      const lastRead = info.channel?.last_read;
      if (!lastRead || lastRead === "0000000000.000000") continue;

      const hist = await makeSlackRequest("conversations.history", {
        channel: ch.id, oldest: lastRead, limit: maxPerChannel, inclusive: false,
      });

      const msgs = (hist.messages || []).filter((m: any) => {
        if (m.subtype === "channel_join" || m.subtype === "channel_leave") return false;
        if (m.bot_id || m.subtype === "bot_message") return false;
        return true;
      });

      if (msgs.length === 0) continue;

      const channelType = ch.is_im ? "dm" : ch.is_mpim ? "group_dm"
        : ch.is_private ? "private" : "public";

      for (const m of msgs) {
        const fromName = await userName(m.user || "unknown");
        items.push({
          source: "slack",
          timestamp: slackTsToEpoch(m.ts),
          from: fromName,
          subject: ch.name || ch.id,
          snippet: (m.text || "").slice(0, 200),
          permalink: makePermalink(teamDomain, ch.id, m.ts),
          category: channelType,
          actionable: channelType === "dm" || channelType === "group_dm",
          meta: {
            channelId: ch.id,
            ...(m.thread_ts && m.thread_ts !== m.ts ? { threadTs: m.thread_ts } : {}),
            ...(m.reply_count ? { replyCount: m.reply_count } : {}),
          },
        });
      }
    } catch { /* skip channel */ }
  }

  return { total: items.length, items };
}

// ---------------------------------------------------------------------------
// Gmail fetcher — native
// ---------------------------------------------------------------------------

async function fetchGmailUnreadNative(
  maxResults: number,
): Promise<{ total: number; items: InboxItem[] }> {
  const resp = await makeGoogleRequest(
    "https://gmail.googleapis.com/gmail/v1/users/me/messages",
    { q: "is:unread in:inbox", maxResults },
  ) as { messages?: Array<{ id: string }>; resultSizeEstimate?: number };

  if (!resp.messages?.length) return { total: 0, items: [] };

  const items: InboxItem[] = [];
  for (const { id } of resp.messages.slice(0, maxResults)) {
    try {
      const msg = await makeGoogleRequest(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`,
        { format: "metadata", metadataHeaders: "From,Subject,Date" },
      ) as {
        id: string; threadId: string; snippet: string; labelIds: string[];
        payload: { headers: GmailHeader[] };
      };
      const from = headerValue(msg.payload.headers, "from");
      const subject = headerValue(msg.payload.headers, "subject");
      const date = headerValue(msg.payload.headers, "date");
      const summary: GmailMessageSummary = {
        id: msg.id, threadId: msg.threadId, from, subject, date, snippet: msg.snippet,
      };
      items.push({
        source: "gmail",
        timestamp: parseDateToEpoch(date),
        from,
        subject,
        snippet: msg.snippet,
        permalink: `https://mail.google.com/mail/u/0/#inbox/${msg.threadId}`,
        category: extractCategory(msg.labelIds),
        actionable: isActionableEmail(summary, msg.labelIds),
        meta: { id: msg.id, threadId: msg.threadId, labelIds: msg.labelIds },
      });
    } catch { /* skip */ }
  }

  return { total: resp.resultSizeEstimate ?? items.length, items };
}

// ---------------------------------------------------------------------------
// Gmail fetcher — MCP fallback
// ---------------------------------------------------------------------------

async function fetchGmailUnreadMcp(
  maxResults: number,
): Promise<{ total: number; items: InboxItem[] }> {
  const registry = getMcpRegistry();
  if (!registry.has("google-workspace")) {
    throw new Error("Google Workspace MCP not configured");
  }

  // Search unread inbox
  const searchResult = await registry.call("google-workspace", "gmail_search", {
    query: "is:unread in:inbox", maxResults,
  });
  const searchData = JSON.parse(
    searchResult.content.find((c) => c.type === "text")?.text || "{}",
  );
  const msgIds: string[] = (searchData.messages || []).map((m: any) => m.id);
  const totalEstimate = searchData.resultSizeEstimate ?? msgIds.length;

  if (msgIds.length === 0) return { total: 0, items: [] };

  // Fetch each message
  const items: InboxItem[] = [];
  for (const id of msgIds.slice(0, maxResults)) {
    try {
      const getResult = await registry.call("google-workspace", "gmail_get", {
        messageId: id, format: "metadata",
      });
      const raw = JSON.parse(
        getResult.content.find((c) => c.type === "text")?.text || "{}",
      );
      const headers = raw.payload?.headers || [];
      const from = headers.find((h: any) => h.name.toLowerCase() === "from")?.value ?? "";
      const subject = headers.find((h: any) => h.name.toLowerCase() === "subject")?.value ?? "";
      const date = headers.find((h: any) => h.name.toLowerCase() === "date")?.value ?? "";
      const labelIds: string[] = raw.labelIds || [];
      const snippet = raw.snippet || "";
      const summary: GmailMessageSummary = {
        id, threadId: raw.threadId ?? "", from, subject, date, snippet,
      };
      items.push({
        source: "gmail",
        timestamp: parseDateToEpoch(date),
        from,
        subject,
        snippet,
        permalink: `https://mail.google.com/mail/u/0/#inbox/${raw.threadId || id}`,
        category: extractCategory(labelIds),
        actionable: isActionableEmail(summary, labelIds),
        meta: { id, threadId: raw.threadId, labelIds },
      });
    } catch { /* skip */ }
  }

  return { total: totalEstimate, items };
}

// ---------------------------------------------------------------------------
// Tool definition
// ---------------------------------------------------------------------------

export default defineTool<
  {
    maxSlackChannels?: number;
    maxMessagesPerChannel?: number;
    maxEmails?: number;
    actionableOnly?: boolean;
  },
  InboxResult
>({
  name: "inbox-unread",
  label: "Unified Inbox — Unread & Unactioned",
  description:
    "Get all unread/unactioned messages from Slack and Gmail in one prioritised view. " +
    "Returns Slack unreads (DMs, channels, group DMs) and Gmail inbox unreads, " +
    "merged and sorted by time. Each item is flagged as actionable when it likely " +
    "needs a response (DMs, important emails, @mentions).",

  params: {
    maxSlackChannels:      { type: "number", default: 50,  description: "Max Slack channels to scan" },
    maxMessagesPerChannel: { type: "number", default: 5,   description: "Max unread messages per Slack channel" },
    maxEmails:             { type: "number", default: 15,  description: "Max Gmail messages to fetch" },
    actionableOnly:        { type: "boolean", default: false, description: "Only return items flagged as actionable" },
  },

  auth: {
    // Available if at least one source is configured
    check: () => !!getSlackAuth() || hasNativeGoogleAuth() || getMcpRegistry().has("google-workspace"),
    service: "slack+google",
  },
  progress: "Scanning Slack and Gmail for unread messages...",

  async execute(p) {
    const maxSlackChannels = p.maxSlackChannels ?? 50;
    const maxPerChannel = p.maxMessagesPerChannel ?? 5;
    const maxEmails = p.maxEmails ?? 15;
    const actionableOnly = p.actionableOnly ?? false;

    // Run Slack and Gmail in parallel
    const [slackResult, gmailResult] = await Promise.allSettled([
      fetchSlackUnread(maxSlackChannels, maxPerChannel),
      (hasNativeGoogleAuth()
        ? fetchGmailUnreadNative(maxEmails)
        : getMcpRegistry().has("google-workspace")
          ? fetchGmailUnreadMcp(maxEmails)
          : Promise.resolve({ total: 0, items: [] as InboxItem[] })
      ),
    ]);

    const slack = slackResult.status === "fulfilled" ? slackResult.value : { total: 0, items: [] };
    const gmail = gmailResult.status === "fulfilled" ? gmailResult.value : { total: 0, items: [] };

    // Log any errors as warnings
    if (slackResult.status === "rejected") {
      console.warn("[inbox-unread] Slack failed:", slackResult.reason);
    }
    if (gmailResult.status === "rejected") {
      console.warn("[inbox-unread] Gmail failed:", gmailResult.reason);
    }

    let items = [...slack.items, ...gmail.items];

    if (actionableOnly) {
      items = items.filter((i) => i.actionable);
    }

    // Sort newest first
    items.sort((a, b) => b.timestamp - a.timestamp);

    return {
      slackTotal: slack.total,
      gmailTotal: gmail.total,
      items,
    };
  },

  format(result) {
    if (result.items.length === 0) {
      return { text: "✅ Inbox zero — no unread messages in Slack or Gmail.", details: result };
    }

    const actionable = result.items.filter((i) => i.actionable);
    const fyi = result.items.filter((i) => !i.actionable);

    const lines: string[] = [];
    lines.push(
      `📬 **${result.items.length} unread** ` +
      `(${result.slackTotal} Slack, ${result.gmailTotal} Gmail) — ` +
      `**${actionable.length} actionable**\n`,
    );

    if (actionable.length > 0) {
      lines.push("### 🔴 Needs Response\n");
      for (const item of actionable) {
        const icon = item.source === "slack" ? "💬" : "📧";
        const age = formatAge(item.timestamp);
        lines.push(
          `${icon} **${item.from}** — ${item.subject}` +
          `  *(${age}, ${item.category})*`,
        );
        lines.push(`   ${item.snippet.slice(0, 140)}`);
        lines.push(`   [Open →](${item.permalink})\n`);
      }
    }

    if (fyi.length > 0) {
      lines.push("### ⚪ FYI / Low Priority\n");
      for (const item of fyi.slice(0, 10)) {
        const icon = item.source === "slack" ? "💬" : "📧";
        const age = formatAge(item.timestamp);
        lines.push(
          `${icon} **${item.from}** — ${item.subject}` +
          `  *(${age}, ${item.category})*`,
        );
        lines.push(`   ${item.snippet.slice(0, 100)}`);
        lines.push(`   [Open →](${item.permalink})\n`);
      }
      if (fyi.length > 10) {
        lines.push(`   … and ${fyi.length - 10} more`);
      }
    }

    return { text: lines.join("\n"), details: result };
  },
});

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatAge(epochMs: number): string {
  if (epochMs === 0) return "unknown";
  const diffMs = Date.now() - epochMs;
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
