import { defineTool } from "../framework.js";
import { getSlackAuth } from "../auth.js";
import {
  makeSlackRequest, getTeamDomain, makePermalink,
  type UnreadChannel,
} from "../services/slack.client.js";

export default defineTool<
  { types?: string; limit?: number; maxMessagesPerChannel?: number; excludeBots?: boolean },
  { totalUnread: number; channels: UnreadChannel[] }
>({
  name: "slack-getUnread",
  label: "Get Unread Slack Messages",
  description: "Find channels and DMs with unread messages. Returns unread messages with links. Requires user token (xoxp-).",

  params: {
    types:                 { type: "string", default: "public_channel,private_channel,mpim,im", description: "Channel types to check" },
    limit:                 { type: "number", default: 50, description: "Max channels to scan" },
    maxMessagesPerChannel: { type: "number", default: 10, description: "Max unread messages per channel" },
    excludeBots:           { type: "boolean", default: true, description: "Exclude bot messages" },
  },

  auth: { check: () => !!getSlackAuth(), service: "slack" },
  progress: "Scanning for unread messages...",

  async execute(p) {
    const types = p.types || "public_channel,private_channel,mpim,im";
    const maxPerChannel = p.maxMessagesPerChannel || 10;
    const excludeBots = p.excludeBots !== false;
    const teamDomain = await getTeamDomain();

    // Paginate conversations.list
    let allFetched: any[] = [];
    let cursor: string | undefined;
    const maxChannels = p.limit || 50;

    do {
      const convResp = await makeSlackRequest("conversations.list", {
        types, limit: Math.min(maxChannels - allFetched.length, 200), exclude_archived: true,
        ...(cursor ? { cursor } : {}),
      });
      allFetched.push(...(convResp.channels || []));
      cursor = convResp.response_metadata?.next_cursor || undefined;
    } while (cursor && allFetched.length < maxChannels);

    const channels = allFetched.filter((ch: any) => ch.is_member || ch.is_im || ch.is_mpim);
    const unreadChannels: UnreadChannel[] = [];

    for (const ch of channels) {
      try {
        const info = await makeSlackRequest("conversations.info", { channel: ch.id });
        const lastRead = info.channel?.last_read;
        if (!lastRead || lastRead === "0000000000.000000") continue;

        const hist = await makeSlackRequest("conversations.history", {
          channel: ch.id, oldest: lastRead, limit: maxPerChannel, inclusive: false,
        });

        const msgs = (hist.messages || []).filter((m: any) => {
          if (m.subtype === "channel_join" || m.subtype === "channel_leave") return false;
          if (excludeBots && (m.bot_id || m.subtype === "bot_message")) return false;
          return true;
        });

        if (msgs.length === 0) continue;

        const channelType = ch.is_im ? "dm" : ch.is_mpim ? "group_dm" : ch.is_private ? "private" : "public";

        unreadChannels.push({
          channelId: ch.id,
          channelName: ch.name || ch.id,
          channelType,
          unreadCount: msgs.length,
          messages: msgs.map((m: any) => ({
            user: m.user || m.bot_id || "unknown",
            text: (m.text || "").slice(0, 300),
            ts: m.ts,
            permalink: makePermalink(teamDomain, ch.id, m.ts),
            ...(m.thread_ts && m.thread_ts !== m.ts ? { threadTs: m.thread_ts } : {}),
            ...(m.reply_count ? { replyCount: m.reply_count } : {}),
          })),
        });
      } catch { /* skip */ }
    }

    unreadChannels.sort((a, b) => b.unreadCount - a.unreadCount);
    const totalUnread = unreadChannels.reduce((sum, ch) => sum + ch.unreadCount, 0);

    return { totalUnread, channels: unreadChannels };
  },

  format(result) {
    if (result.channels.length === 0) {
      return { text: "No unread messages across any channels or DMs.", details: result };
    }

    const lines = result.channels.map((ch) => {
      const header = `**${ch.channelName}** (${ch.channelType}) — ${ch.unreadCount} unread`;
      const msgs = ch.messages.slice(0, 5).map((m) =>
        `    • ${m.user}: "${m.text.slice(0, 120)}" — ${m.permalink}`,
      ).join("\n");
      return `  ${header}\n${msgs}`;
    }).join("\n\n");

    return {
      text: `${result.totalUnread} unread messages across ${result.channels.length} conversations:\n\n${lines}`,
      details: result,
    };
  },
});
