import { getSlackAuth } from "../auth.js";
import { defineTool } from "../framework.js";
import {
  getTeamDomain,
  makePermalink,
  makeSlackRequest,
  type SlackConversationsHistoryResult,
  type SlackMessage,
} from "../services/slack.client.js";

export default defineTool<
  { channelId: string; limit?: number; oldest?: string; includeThreads?: boolean },
  {
    channelId: string;
    messages: Array<{
      user: string;
      text: string;
      ts: string;
      permalink: string;
      replyCount?: number;
    }>;
  }
>({
  name: "slack-getChannelHistory",
  label: "Get Channel History",
  description: "Read recent messages from a Slack channel with optional thread replies",

  params: {
    channelId: { type: "string", required: true, description: "Channel ID" },
    limit: { type: "number", default: 20, description: "Number of messages" },
    oldest: { type: "string", description: "Only messages after this timestamp" },
    includeThreads: { type: "boolean", default: false, description: "Fetch thread replies" },
  },

  auth: { check: () => !!getSlackAuth(), service: "slack" },
  progress: (p) => `Getting messages from ${p.channelId}`,

  async execute(p) {
    const teamDomain = await getTeamDomain();
    const hist = await makeSlackRequest<SlackConversationsHistoryResult>("conversations.history", {
      channel: p.channelId,
      limit: p.limit || 20,
      ...(p.oldest ? { oldest: p.oldest } : {}),
    });

    const messages = (hist.messages || []) as SlackMessage[];

    // Optionally fetch thread replies
    if (p.includeThreads) {
      for (const msg of messages) {
        if (msg.reply_count && msg.reply_count > 0 && msg.ts) {
          try {
            const threadResp = await makeSlackRequest<SlackConversationsHistoryResult>(
              "conversations.replies",
              {
                channel: p.channelId,
                ts: msg.ts,
                limit: 5,
              },
            );
            msg.replies = threadResp.messages?.slice(1) || [];
          } catch {
            /* skip */
          }
        }
      }
    }

    return {
      channelId: p.channelId,
      messages: messages.map((m) => ({
        user: m.user || m.bot_id || "unknown",
        text: (m.text || "").slice(0, 300),
        ts: m.ts,
        permalink: makePermalink(teamDomain, p.channelId, m.ts),
        ...(m.reply_count ? { replyCount: m.reply_count } : {}),
      })),
    };
  },

  format(result) {
    const lines = result.messages
      .slice(0, 15)
      .map(
        (m) =>
          `  • ${m.user}: "${m.text.slice(0, 120)}" — ${m.permalink}${m.replyCount ? ` [${m.replyCount} replies]` : ""}`,
      )
      .join("\n");
    return {
      text: `${result.messages.length} messages from ${result.channelId}:\n${lines}`,
      details: result,
    };
  },
});
