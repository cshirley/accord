import { defineTool } from "../framework.js";
import { getSlackAuth } from "../auth.js";
import { makeSlackRequest } from "../services/slack.client.js";

export default defineTool<{ userId: string }, { displayName: string; realName: string; email?: string; title?: string; statusText?: string }>({
  name: "slack-getUserInfo",
  label: "Get Slack User Info",
  description: "Get information about a Slack user",

  params: {
    userId: { type: "string", required: true, description: "Slack user ID" },
  },

  auth: { check: () => !!getSlackAuth(), service: "slack" },
  progress: (p) => `Looking up user ${p.userId}`,

  async execute(p) {
    const resp = await makeSlackRequest("users.info", { user: p.userId });
    const u = resp.user;
    return {
      displayName: u.profile?.display_name || u.real_name || u.name,
      realName: u.real_name || u.name,
      email: u.profile?.email,
      title: u.profile?.title,
      statusText: u.profile?.status_text,
    };
  },

  format(user) {
    return {
      text: `${user.displayName} (${user.realName})${user.title ? ` — ${user.title}` : ""}`,
      details: user,
    };
  },
});
