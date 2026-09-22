/**
 * Shared authentication utilities.
 *
 * Auth file path is resolved from:
 *   1. AI_TOOLS_AUTH_PATH env var
 *   2. ~/.pi/agent/service-auth.json (default)
 *
 * No dependency on pi's extension API.
 */

import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const AUTH_FILE =
  process.env.AI_TOOLS_AUTH_PATH ?? join(homedir(), ".pi", "agent", "service-auth.json");

interface AuthStore {
  jira?: { email: string; apiToken: string; baseUrl: string };
  slack?: { token: string; userId?: string };
  google?: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    clientId: string;
    clientSecret: string;
    handoffMode?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Store read/write
// ---------------------------------------------------------------------------

export function loadAuth(): AuthStore {
  if (!existsSync(AUTH_FILE)) return {};
  try {
    return JSON.parse(readFileSync(AUTH_FILE, "utf-8"));
  } catch {
    return {};
  }
}

export function saveAuth(auth: AuthStore): void {
  try {
    writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), { mode: 0o600 });
    // `mode` only applies when the file is created, so re-assert it for files
    // written before this was enforced.
    chmodSync(AUTH_FILE, 0o600);
  } catch (e) {
    console.error("Failed to save auth file:", e);
  }
}

// ---------------------------------------------------------------------------
// Jira
// ---------------------------------------------------------------------------

export function getJiraAuth(): { email: string; apiToken: string; baseUrl: string } | null {
  const auth = loadAuth();
  if (auth.jira) return auth.jira;
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_KEY;
  if (email && apiToken) {
    return {
      email,
      apiToken,
      baseUrl: process.env.JIRA_BASE_URL ?? "https://babylonpartners.atlassian.net",
    };
  }
  return null;
}

export function setJiraAuth(email: string, apiToken: string, baseUrl: string): void {
  const auth = loadAuth();
  auth.jira = { email, apiToken, baseUrl };
  saveAuth(auth);
}

// ---------------------------------------------------------------------------
// Slack
// ---------------------------------------------------------------------------

export function getSlackAuth(): { token: string; userId?: string } | null {
  const auth = loadAuth();
  if (auth.slack) return auth.slack;
  const envToken = process.env.SLACK_BOT_TOKEN;
  if (envToken) return { token: envToken };
  return null;
}

export function setSlackAuth(token: string, userId?: string): void {
  const auth = loadAuth();
  auth.slack = { token, userId };
  saveAuth(auth);
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

export function getGoogleAuth() {
  const auth = loadAuth();
  return auth.google ?? null;
}

export function setGoogleAuth(
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
  clientId: string,
  clientSecret: string,
): void {
  const auth = loadAuth();
  auth.google = {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
    clientId,
    clientSecret,
  };
  saveAuth(auth);
}

export async function refreshGoogleToken(): Promise<string | null> {
  const auth = getGoogleAuth();
  if (!auth) return null;
  if (auth.expiresAt > Date.now() + 300_000) return auth.accessToken;

  try {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: auth.clientId,
        client_secret: auth.clientSecret,
        refresh_token: auth.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as { access_token: string; expires_in: number };
    setGoogleAuth(
      data.access_token,
      auth.refreshToken,
      data.expires_in,
      auth.clientId,
      auth.clientSecret,
    );
    return data.access_token;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Header helpers
// ---------------------------------------------------------------------------

export function createBasicAuthHeader(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
}

export function createBearerAuthHeader(token: string): string {
  return `Bearer ${token}`;
}
