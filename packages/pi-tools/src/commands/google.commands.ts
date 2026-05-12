import { spawn } from "node:child_process";
import { loadAuth, refreshGoogleToken, saveAuth, setGoogleAuth } from "../auth.js";
import { defineCommands } from "../framework.js";
import { getMcpRegistry, mcpText } from "../mcp-registry.js";
import { hasNativeGoogleAuth, makeGoogleRequest } from "../services/google.client.js";

function openUrl(url: string): void {
  const cmd =
    process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  spawn(cmd, [url], { detached: true, stdio: "ignore" });
}

export default defineCommands("google", {
  setup: {
    description: "Configure Google Workspace authentication (OAuth2) or handoff mode",
    handler: async ({ ui }) => {
      if (getMcpRegistry().has("google-workspace")) {
        ui.notify(
          "✅ Google Workspace MCP fallback available.\nNative OAuth gives faster, direct access.",
          "info",
        );
      }

      const hasOAuth = await ui.confirm(
        "OAuth Access?",
        "Can you create OAuth2 apps in Google Cloud Console?",
      );

      if (!hasOAuth) {
        const auth = loadAuth();
        auth.google = {
          handoffMode: true,
          accessToken: "",
          refreshToken: "",
          expiresAt: 0,
          clientId: "",
          clientSecret: "",
        } as any;
        saveAuth(auth);
        ui.notify("🔄 Google handoff mode enabled.", "info");
        return;
      }

      const clientId = await ui.input("Google OAuth2 Client ID:", "");
      if (!clientId?.trim()) {
        ui.notify("Cancelled", "info");
        return;
      }
      const clientSecret = await ui.input("Google OAuth2 Client Secret:", "");
      if (!clientSecret?.trim()) {
        ui.notify("Cancelled", "info");
        return;
      }

      const redirectUri = "http://localhost:8080";
      const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      authUrl.searchParams.append("client_id", clientId);
      authUrl.searchParams.append("redirect_uri", redirectUri);
      authUrl.searchParams.append("response_type", "code");
      authUrl.searchParams.append(
        "scope",
        "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.readonly",
      );
      authUrl.searchParams.append("access_type", "offline");
      authUrl.searchParams.append("prompt", "consent");
      ui.notify("Opening browser for authentication...", "info");
      openUrl(authUrl.toString());

      const authCode = await ui.input("Enter the authorization code:", "");
      if (!authCode?.trim()) {
        ui.notify("Cancelled", "info");
        return;
      }

      try {
        const tokenResp = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code: authCode.trim(),
            grant_type: "authorization_code",
            redirect_uri: redirectUri,
          }),
        });
        if (!tokenResp.ok) throw new Error(`Token exchange failed: ${tokenResp.status}`);
        const td = (await tokenResp.json()) as {
          access_token: string;
          refresh_token: string;
          expires_in: number;
        };
        setGoogleAuth(td.access_token, td.refresh_token, td.expires_in, clientId, clientSecret);
        const profile = (await makeGoogleRequest(
          "https://www.googleapis.com/oauth2/v2/userinfo",
        )) as { name: string; email: string };
        ui.notify(`Google configured! ✅  User: ${profile.name} (${profile.email})`, "info");
      } catch (error) {
        ui.notify(
          `Setup failed: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
      }
    },
  },

  status: {
    description: "Check Google Workspace authentication status",
    test: async () => {
      if (hasNativeGoogleAuth()) {
        try {
          const token = await refreshGoogleToken();
          if (token) {
            const profile = (await makeGoogleRequest(
              "https://www.googleapis.com/oauth2/v2/userinfo",
            )) as { name: string; email: string };
            return {
              ok: true,
              message: `Google connected (OAuth): ${profile.name} (${profile.email})`,
            };
          }
        } catch {
          /* fall through */
        }
      }

      if (getMcpRegistry().has("google-workspace")) {
        try {
          const result = await getMcpRegistry().call("google-workspace", "people_getMe", {});
          return { ok: true, message: `Google connected via MCP ✅\n${mcpText(result)}` };
        } catch {
          /* fall through */
        }
      }

      return { ok: false, message: "Google not configured. Use /google-setup" };
    },
  },
});
