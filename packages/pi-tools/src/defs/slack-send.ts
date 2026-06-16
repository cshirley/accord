import { getSlackAuth } from "../auth.js";
import { defineTool } from "../framework.js";
import { type SendSlackMessageResult, sendSlackMessage } from "../services/slack.client.js";

export default defineTool<
  { target: string; text: string; threadTs?: string },
  SendSlackMessageResult
>({
  name: "slack-sendMessage",
  label: "Send Slack Message",
  description:
    "Send a Slack message. Target accepts a channel ID, #channel-name, user ID, @display-name, or email (emails/users open a DM). Text supports Slack mrkdwn. Returns the permalink.",

  params: {
    target: {
      type: "string",
      required: true,
      description: "Channel ID, #channel-name, user ID, @display-name, or email",
    },
    text: { type: "string", required: true, description: "Message text (Slack mrkdwn)" },
    threadTs: {
      type: "string",
      description: "Optional parent message ts to reply in a thread",
    },
  },

  auth: { check: () => !!getSlackAuth(), service: "slack" },
  progress: (p) => `Sending Slack message to ${p.target}`,

  async execute(p) {
    return sendSlackMessage({ target: p.target, text: p.text, threadTs: p.threadTs });
  },

  format(result) {
    return {
      text: `Message sent → ${result.permalink}`,
      details: result as unknown as Record<string, unknown>,
    };
  },
});
