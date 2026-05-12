import { defineTool } from "../framework.js";
import {
  type CalendarEvent,
  filterCalendarEvents,
  hasNativeGoogleAuth,
  makeGoogleRequest,
} from "../services/google.client.js";

export default defineTool<
  { calendarId?: string; date?: string; timeMin?: string; timeMax?: string; maxResults?: number },
  CalendarEvent[]
>({
  name: "google-workspace-calendar_listEvents",
  label: "List Calendar Events",
  description: "List today's events from Google Calendar with full details",

  params: {
    calendarId: { type: "string", default: "primary", description: "Calendar ID" },
    date: { type: "string", description: "Date in YYYY-MM-DD format (defaults to today)" },
    timeMin: { type: "string", description: "Start time (RFC3339)" },
    timeMax: { type: "string", description: "End time (RFC3339)" },
    maxResults: { type: "number", default: 50, description: "Max results" },
  },

  auth: { check: hasNativeGoogleAuth, service: "google" },
  progress: "Getting calendar events...",

  async execute(p) {
    const now = new Date();
    const timeMin =
      p.timeMin || new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const timeMax =
      p.timeMax || new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString();
    const calendarId = p.calendarId || "primary";

    const resp = (await makeGoogleRequest(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        timeMin,
        timeMax,
        maxResults: p.maxResults || 50,
        singleEvents: true,
        orderBy: "startTime",
      },
    )) as { items?: CalendarEvent[] };

    return filterCalendarEvents(resp.items || []);
  },

  mcp: {
    server: "google-workspace",
    tool: "calendar_listEvents",
    mapParams: (p) => ({
      calendarId: p.calendarId || "primary",
      date: p.date || new Date().toISOString().slice(0, 10),
      ...(p.timeMin && { timeMin: p.timeMin }),
      ...(p.timeMax && { timeMax: p.timeMax }),
      maxResults: p.maxResults || 50,
    }),
    mapResult: (raw: any) => {
      const events: CalendarEvent[] = Array.isArray(raw) ? raw : (raw.items ?? []);
      const targetDate = new Date().toISOString().slice(0, 10);
      return filterCalendarEvents(events).filter((ev) => {
        const startDt = ev.start?.dateTime || "";
        const startDate = ev.start?.date || "";
        return startDt.startsWith(targetDate) || startDate === targetDate;
      });
    },
  },

  format(events) {
    if (events.length === 0) return { text: "No events", details: {} };
    const lines = events.map((ev) => {
      const start = ev.start?.dateTime?.slice(11, 16) ?? "all-day";
      const end = ev.end?.dateTime?.slice(11, 16) ?? "";
      const time = end ? `${start}–${end}` : start;
      const attendees = ev.attendees?.length ?? 0;
      return `${time} | ${ev.summary ?? "(no title)"}${attendees ? ` (${attendees} attendees)` : ""}`;
    });
    return {
      text: `${events.length} events\n${lines.join("\n")}`,
      details: { events },
    };
  },
});
