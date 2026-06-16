import { getSlackAuth } from "../auth.js";
import { defineTool } from "../framework.js";
import {
  makeSlackRequest,
  resolveUserId,
  type SlackUsersInfoResult,
} from "../services/slack.client.js";

export default defineTool<
  { query: string },
  { userId: string; displayName: string; realName: string; email?: string; title?: string }
>({
  name: "slack-lookupUser",
  label: "Look Up Slack User",
  description:
    "Resolve a Slack user by display name, real name, @handle, or email to their user ID and profile. Use before slack-sendMessage when you only know a person's name.",

  params: {
    query: {
      type: "string",
      required: true,
      description: "Display name, @handle, real name, or email",
    },
  },

  auth: { check: () => !!getSlackAuth(), service: "slack" },
  progress: (p) => `Looking up Slack user "${p.query}"`,

  async execute(p) {
    const userId = await resolveUserId(p.query);
    const resp = await makeSlackRequest<SlackUsersInfoResult>("users.info", { user: userId });
    const u = resp.user;
    return {
      userId,
      displayName: u?.profile?.display_name || u?.real_name || u?.name || userId,
      realName: u?.real_name || u?.name || userId,
      email: u?.profile?.email,
      title: u?.profile?.title,
    };
  },

  format(user) {
    return {
      text: `${user.displayName} → ${user.userId}${user.email ? ` (${user.email})` : ""}`,
      details: user,
    };
  },
});
