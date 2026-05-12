import { defineTool } from "../framework.js";
import {
  type GmailHeader,
  type GmailMessageSummary,
  hasNativeGoogleAuth,
  headerValue,
  makeGoogleRequest,
} from "../services/google.client.js";

export default defineTool<
  { query: string; maxResults?: number },
  { total: number; messages: GmailMessageSummary[] }
>({
  name: "google-workspace-gmail_search",
  label: "Gmail Search",
  description: "Search Gmail messages",

  params: {
    query: { type: "string", required: true, description: "Gmail search query" },
    maxResults: { type: "number", default: 25, description: "Maximum results" },
  },

  auth: { check: hasNativeGoogleAuth, service: "google" },
  progress: (p) => `Searching Gmail: ${p.query}`,

  async execute(p) {
    const resp = (await makeGoogleRequest(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages",
      { q: p.query, maxResults: p.maxResults || 25 },
    )) as { messages?: Array<{ id: string }>; resultSizeEstimate?: number };

    if (!resp.messages?.length) return { total: 0, messages: [] };

    const messages: GmailMessageSummary[] = [];
    for (let i = 0; i < Math.min(resp.messages.length, 10); i++) {
      try {
        const msg = (await makeGoogleRequest(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${resp.messages[i].id}`,
          { format: "metadata", metadataHeaders: "From,Subject,Date" },
        )) as {
          id: string;
          threadId: string;
          snippet: string;
          payload: { headers: GmailHeader[] };
        };
        messages.push({
          id: msg.id,
          threadId: msg.threadId,
          from: headerValue(msg.payload.headers, "from"),
          subject: headerValue(msg.payload.headers, "subject"),
          date: headerValue(msg.payload.headers, "date"),
          snippet: msg.snippet,
        });
      } catch {
        /* skip */
      }
    }

    return { total: resp.resultSizeEstimate ?? 0, messages };
  },

  mcp: {
    server: "google-workspace",
    tool: "gmail_search",
    mapParams: (p) => ({ query: p.query, maxResults: p.maxResults || 25 }),
    mapResult: (raw: any) => {
      const messages = (raw.messages || []).map((m: any) => ({
        id: m.id ?? "",
        threadId: m.threadId ?? "",
        from: m.from ?? "",
        subject: m.subject ?? "",
        date: m.date ?? "",
        snippet: m.snippet ?? "",
      }));
      return { total: raw.resultSizeEstimate ?? messages.length, messages };
    },
  },

  format(result) {
    if (result.messages.length === 0) return { text: "No messages found", details: result };
    const lines = result.messages.map(
      (m) => `${m.date?.slice(0, 16) ?? ""} | ${m.from?.slice(0, 40)} | ${m.subject} [${m.id}]`,
    );
    return {
      text: `${result.total} messages (showing ${result.messages.length})\n${lines.join("\n")}`,
      details: result,
    };
  },
});
