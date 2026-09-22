import { getJiraAuth, setJiraAuth } from "../auth.js";
import { defineCommands } from "../framework.js";
import { makeJiraRequest } from "../services/jira.client.js";

export default defineCommands("jira", {
  setup: {
    description: "Configure Jira authentication (email + API token)",
    handler: async ({ ui }) => {
      let email = await ui.input("Jira Email (or Enter to use $JIRA_EMAIL):", "");
      if (!email?.trim()) {
        email = process.env.JIRA_EMAIL ?? "";
        if (!email) {
          ui.notify("Cancelled — no email and $JIRA_EMAIL not set", "info");
          return;
        }
        ui.notify("Using $JIRA_EMAIL from environment", "info");
      }

      let apiToken = await ui.input("Jira API Token (or Enter to use $JIRA_API_KEY):", "");
      if (!apiToken?.trim()) {
        apiToken = process.env.JIRA_API_KEY ?? "";
        if (!apiToken) {
          ui.notify("Cancelled — no token and $JIRA_API_KEY not set", "info");
          return;
        }
        ui.notify("Using $JIRA_API_KEY from environment", "info");
      }

      const baseUrl = await ui.input(
        "Atlassian Base URL:",
        process.env.JIRA_BASE_URL ?? "https://babylonpartners.atlassian.net",
      );
      if (!baseUrl?.trim()) {
        ui.notify("Cancelled", "info");
        return;
      }

      try {
        setJiraAuth(email.trim(), apiToken.trim(), baseUrl.trim());
        await makeJiraRequest("myself");
        ui.notify("Jira configured successfully! ✅", "info");
      } catch (error) {
        ui.notify(
          `Jira setup failed: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
      }
    },
  },

  status: {
    description: "Check Jira authentication status",
    test: async () => {
      const auth = getJiraAuth();
      if (!auth) return { ok: false, message: "Jira not configured. Use /jira-setup" };
      try {
        const user = (await makeJiraRequest("myself")) as { displayName: string };
        return {
          ok: true,
          message: `Jira connected: ${user.displayName} (${auth.email}) at ${auth.baseUrl}`,
        };
      } catch (error) {
        return {
          ok: false,
          message: `Jira connection failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    },
  },
});
