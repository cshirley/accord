import { getSlackAuth, setSlackAuth } from "../auth.js";
import { defineCommands } from "../framework.js";
import { sendSlackMessage } from "../services/slack.client.js";

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

  extra: {
    send: {
      description:
        "Send a Slack message: /slack-send [--thread <ts>] <#channel|@user|email|channelId> <message>",
      handler: async (args, { ui }) => {
        // Extract an optional --thread <ts> (or --reply <ts>) flag from anywhere in the args.
        let threadTs: string | undefined;
        const trimmed = args
          .trim()
          .replace(/(?:^|\s)--(?:thread|reply)[=\s]+(\S+)/, (_m, ts) => {
            threadTs = ts;
            return "";
          })
          .trim();

        let target = "";
        let text = "";
        if (trimmed) {
          const splitAt = trimmed.search(/\s/);
          if (splitAt === -1) {
            target = trimmed;
          } else {
            target = trimmed.slice(0, splitAt);
            text = trimmed.slice(splitAt + 1).trim();
          }
        }

        if (!target) {
          target = (await ui.input("Channel (#name, channelId, @user, or email):", "")) ?? "";
        }
        if (!target.trim()) {
          ui.notify("Cancelled", "info");
          return;
        }

        if (!text) {
          text = (await ui.input("Message:", "")) ?? "";
        }
        if (!text.trim()) {
          ui.notify("Cancelled", "info");
          return;
        }

        try {
          const result = await sendSlackMessage({ target, text, threadTs });
          ui.notify(`Message sent ✅  ${result.permalink}`, "info");
        } catch (error) {
          ui.notify(
            `Slack send failed: ${error instanceof Error ? error.message : String(error)}`,
            "error",
          );
        }
      },
    },
  },
});
