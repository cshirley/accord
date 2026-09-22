import { getGoogleAuth, getJiraAuth, getSlackAuth, refreshGoogleToken } from "../auth.js";
import { defineTool } from "../framework.js";
import { getMcpRegistry } from "../mcp-registry.js";
import { hasNativeGoogleAuth } from "../services/google.client.js";

interface PreflightResult {
  jira: string;
  slack: string;
  google: string;
  google_backend?: string;
}

async function testJira(): Promise<boolean> {
  try {
    const auth = getJiraAuth();
    if (!auth) return false;
    const resp = await fetch(`${auth.baseUrl}/rest/api/3/myself`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${auth.email}:${auth.apiToken}`).toString("base64")}`,
        Accept: "application/json",
      },
    });
    return resp.ok;
  } catch {
    return false;
  }
}

async function testSlack(): Promise<boolean> {
  try {
    const auth = getSlackAuth();
    if (!auth) return false;
    const resp = await fetch("https://slack.com/api/auth.test", {
      headers: { Authorization: `Bearer ${auth.token}` },
    });
    const data = await resp.json();
    return data.ok === true;
  } catch {
    return false;
  }
}

async function testGoogle(): Promise<"oauth" | "mcp" | "handoff" | false> {
  if (hasNativeGoogleAuth()) {
    try {
      const token = await refreshGoogleToken();
      if (token) {
        const resp = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (resp.ok) return "oauth";
      }
    } catch {
      /* fall through */
    }
  }
  try {
    if (getMcpRegistry().has("google-workspace")) {
      await getMcpRegistry().call("google-workspace", "time_getCurrentDate", {});
      return "mcp";
    }
  } catch {
    /* fall through */
  }
  try {
    const auth = getGoogleAuth();
    if (auth && (auth as Record<string, unknown>).handoffMode) return "handoff";
  } catch {
    /* ignore */
  }
  return false;
}

export default defineTool<Record<string, never>, PreflightResult>({
  name: "native_preflight_check",
  label: "Native Services Preflight Check",
  description: "Test connectivity to configured native services (Jira, Slack, Google)",

  params: {},
  progress: "Testing service connections...",

  async execute() {
    const results: PreflightResult = {
      jira: "unavailable",
      slack: "unavailable",
      google: "unavailable",
    };

    const jiraOk = await testJira();
    results.jira = jiraOk ? "available" : "unavailable";
    if (!jiraOk && getMcpRegistry().has("atlassian")) results.jira = "available (MCP fallback)";

    results.slack = (await testSlack()) ? "available" : "unavailable";

    const googleBackend = await testGoogle();
    if (googleBackend === "oauth") {
      results.google = "available";
      results.google_backend = "oauth";
    } else if (googleBackend === "mcp") {
      results.google = "available";
      results.google_backend = "mcp";
    } else if (googleBackend === "handoff") {
      results.google = "handoff_mode";
    }

    return results;
  },

  format(r) {
    const parts = [
      `Jira ${r.jira.includes("available") ? "✓" : "✗"}`,
      `Slack ${r.slack === "available" ? "✓" : "✗"}`,
      `Google ${r.google.includes("available") ? "✓" : r.google === "handoff_mode" ? "🔄" : "✗"}`,
    ];
    return {
      text: `Integrations: ${parts.join(" | ")}`,
      details: r as unknown as Record<string, unknown>,
    };
  },
});
