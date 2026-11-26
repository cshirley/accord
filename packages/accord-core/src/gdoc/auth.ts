/**
 * Reuse google-workspace MCP OAuth tokens from macOS Keychain.
 * Falls back gracefully when unavailable (Linux / no auth yet).
 */

import { execSync } from "node:child_process";

const KEYCHAIN_SERVICE = "gemini-cli-workspace-oauth";
const KEYCHAIN_ACCOUNT = "main-account";
const CLOUD_FUNCTION_URL =
  process.env.WORKSPACE_CLOUD_FUNCTION_URL ?? "https://google-workspace-extension.geminicli.com";
const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

interface StoredToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

function readKeychainCredentials(): StoredToken | null {
  if (process.platform !== "darwin") return null;
  try {
    const raw = execSync(
      `security find-generic-password -s ${KEYCHAIN_SERVICE} -a ${KEYCHAIN_ACCOUNT} -w 2>/dev/null`,
      { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] },
    ).trim();
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      token?: { accessToken?: string; refreshToken?: string; expiresAt?: number };
    };
    if (!parsed.token?.accessToken) return null;
    return {
      accessToken: parsed.token.accessToken,
      refreshToken: parsed.token.refreshToken,
      expiresAt: parsed.token.expiresAt,
    };
  } catch {
    return null;
  }
}

async function refreshAccessToken(refreshToken: string): Promise<StoredToken> {
  const response = await fetch(`${CLOUD_FUNCTION_URL}/refreshToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!response.ok) {
    throw new Error(`Token refresh failed (${response.status}): ${await response.text()}`);
  }
  const data = (await response.json()) as {
    access_token?: string;
    expires_in?: number;
    expiry_date?: number;
  };
  if (!data.access_token) throw new Error("Token refresh returned no access_token");
  const expiresAt =
    data.expiry_date ?? (data.expires_in ? Date.now() + data.expires_in * 1000 : undefined);
  return {
    accessToken: data.access_token,
    refreshToken,
    expiresAt,
  };
}

/** Return a valid Google access token when Keychain auth is available. */
export async function getGoogleAccessToken(): Promise<string | null> {
  const stored = readKeychainCredentials();
  if (!stored) return null;

  const expiring =
    stored.expiresAt != null && stored.expiresAt < Date.now() + TOKEN_EXPIRY_BUFFER_MS;
  if (!expiring) return stored.accessToken;

  if (!stored.refreshToken) return null;
  const refreshed = await refreshAccessToken(stored.refreshToken);
  return refreshed.accessToken;
}
