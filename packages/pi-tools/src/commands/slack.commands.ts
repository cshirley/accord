import { getSlackAuth, setSlackAuth } from "../auth.js";
import { defineCommands } from "../framework.js";

export default defineCommands("slack", {
  setup: {
    description: "Configure Slack authentication (user or bot token)",
    handler: async ({ ui }) => {
      const token = await ui.input("Slack Token (xoxp- or xoxb-):", "");
      if (!token?.trim()) {
        ui.notify("Cancelled", "info");
        return;
      }

      try {
        setSlackAuth(token.trim());
        const resp = await fetch("https://slack.com/api/auth.test", {
          headers: { Authorization: `Bearer ${token.trim()}` },
        });
        const data = await resp.json();
        if (data.ok) {
          ui.notify(`Slack configured! ✅  User: ${data.user} @ ${data.team}`, "info");
        } else {
          ui.notify(`Slack token invalid: ${data.error}`, "error");
        }
      } catch (error) {
        ui.notify(
          `Slack setup failed: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
      }
    },
  },

  status: {
    description: "Check Slack authentication status",
    test: async () => {
      const auth = getSlackAuth();
      if (!auth) return { ok: false, message: "Slack not configured. Use /slack-setup" };
      try {
        const resp = await fetch("https://slack.com/api/auth.test", {
          headers: { Authorization: `Bearer ${auth.token}` },
        });
        const data = await resp.json();
        if (data.ok) return { ok: true, message: `Slack connected: ${data.user} @ ${data.team}` };
        return { ok: false, message: `Slack auth failed: ${data.error}` };
      } catch (error) {
        return {
          ok: false,
          message: `Slack test failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  },
});
