import { getSlackAuth } from "../auth.js";
import { defineTool } from "../framework.js";
import { makeSlackRequest, type SlackChannel } from "../services/slack.client.js";

export default defineTool<
  { types?: string; limit?: number },
  { channels: Array<{ id: string; name: string; type: string }> }
>({
  name: "slack-getConversations",
  label: "Get Slack Conversations",
  description: "List Slack channels and conversations the user is in",

  params: {
    types: {
      type: "string",
      default: "public_channel,private_channel,mpim,im",
      description: "Channel types",
    },
    limit: { type: "number", default: 100, description: "Maximum channels to return" },
  },

  auth: { check: () => !!getSlackAuth(), service: "slack" },
  progress: "Getting conversations...",

  async execute(p) {
    const resp = await makeSlackRequest("conversations.list", {
      types: p.types || "public_channel,private_channel,mpim,im",
      limit: p.limit || 100,
      exclude_archived: true,
    });

    const channels = (resp.channels || []).map((ch: SlackChannel) => ({
      id: ch.id,
      name: ch.name || ch.id,
      type: ch.is_im ? "dm" : ch.is_mpim ? "group_dm" : ch.is_private ? "private" : "public",
    }));

    return { channels };
  },

  format(result) {
    return {
      text: `${result.channels.length} conversations`,
      details: result,
    };
  },
});
