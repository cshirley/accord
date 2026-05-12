import { getSlackAuth } from "../auth.js";
import { defineTool } from "../framework.js";
import {
  getTeamDomain,
  makePermalink,
  makeSlackRequest,
  type UnansweredDM,
} from "../services/slack.client.js";

export default defineTool<{ userId: string; limit?: number; oldest?: string }, UnansweredDM[]>({
  name: "slack-getDMHistory",
  label: "Get Unanswered DMs",
  description: "Find unanswered DM threads that need a response",

  params: {
    userId: { type: "string", required: true, description: "Your Slack user ID" },
    limit: { type: "number", default: 10, description: "Max DM conversations to check" },
    oldest: { type: "string", description: "Only check messages after this timestamp" },
  },

  auth: { check: () => !!getSlackAuth(), service: "slack" },
  progress: "Checking DMs for unanswered messages...",

  async execute(p) {
    const teamDomain = await getTeamDomain();
    const convResp = await makeSlackRequest("conversations.list", {
      types: "im",
      limit: p.limit || 10,
      exclude_archived: true,
    });

    const unanswered: UnansweredDM[] = [];

    for (const ch of (convResp.channels || []).slice(0, p.limit || 10)) {
      try {
        const hist = await makeSlackRequest("conversations.history", {
          channel: ch.id,
          limit: 1,
          ...(p.oldest ? { oldest: p.oldest } : {}),
        });
        const lastMsg = hist.messages?.[0];
        if (lastMsg && lastMsg.user !== p.userId && !lastMsg.subtype) {
          // Skip if you've reacted to the message (emoji = acknowledgement)
          const youReacted = (lastMsg.reactions || []).some((r: any) =>
            (r.users || []).includes(p.userId),
          );
          if (!youReacted) {
            unanswered.push({
              channel: ch.id,
              user: lastMsg.user,
              lastMessage: (lastMsg.text || "").slice(0, 200),
              ts: lastMsg.ts,
              permalink: makePermalink(teamDomain, ch.id, lastMsg.ts),
            });
          }
        }
      } catch {
        /* skip */
      }
    }

    return unanswered;
  },

  format(threads) {
    if (threads.length === 0)
      return { text: "No unanswered DM threads", details: { unanswered: [] } };

    const lines = threads
      .map((t) => `  • From user ${t.user}: "${t.lastMessage.slice(0, 120)}" — ${t.permalink}`)
      .join("\n");
    return {
      text: `${threads.length} unanswered DM threads:\n${lines}`,
      details: { unanswered: threads },
    };
  },
});
