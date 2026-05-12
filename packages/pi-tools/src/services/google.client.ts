/**
 * Google Workspace HTTP client and shared types.
 * Pure functions — no pi dependency.
 */

import { createBearerAuthHeader, getGoogleAuth, refreshGoogleToken } from "../auth.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GmailHeader {
  name: string;
  value: string;
}

export interface GmailMessageSummary {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  date: string;
  snippet: string;
}

export interface CalendarAttendee {
  self?: boolean;
  responseStatus?: string;
  displayName?: string;
  email?: string;
}

export interface CalendarEvent {
  eventType?: string;
  summary?: string;
  attendees?: CalendarAttendee[];
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// HTTP helper
// ---------------------------------------------------------------------------

export async function makeGoogleRequest(
  endpoint: string,
  params?: Record<string, string | number | boolean>,
): Promise<unknown> {
  const token = await refreshGoogleToken();
  if (!token) throw new Error("Google OAuth token expired and could not refresh.");

  const url = new URL(endpoint);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.append(key, String(value));
    }
  }

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: createBearerAuthHeader(token),
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google API error (${response.status}): ${errorText}`);
  }

  return response.json();
}

// ---------------------------------------------------------------------------
// Auth check
// ---------------------------------------------------------------------------

export function hasNativeGoogleAuth(): boolean {
  const auth = getGoogleAuth();
  if (!auth) return false;
  if ((auth as Record<string, unknown>).handoffMode) return false;
  return !!auth.refreshToken;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function headerValue(headers: GmailHeader[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

const WORKING_LOCATION_SUMMARIES = new Set(["home", "office", "wfh", "remote"]);

export function filterCalendarEvents(events: CalendarEvent[]): CalendarEvent[] {
  return events.filter((ev) => {
    if (ev.eventType === "workingLocation") return false;
    const summary = (ev.summary || "").trim().toLowerCase();
    if (WORKING_LOCATION_SUMMARIES.has(summary) && !ev.attendees?.length) return false;
    const me = (ev.attendees || []).find((a) => a.self);
    if (me?.responseStatus === "declined") return false;
    return true;
  });
}
