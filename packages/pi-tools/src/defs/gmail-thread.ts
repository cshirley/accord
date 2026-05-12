import { defineTool } from "../framework.js";
import {
  type GmailHeader,
  type GmailMessageSummary,
  hasNativeGoogleAuth,
  headerValue,
  makeGoogleRequest,
} from "../services/google.client.js";

export default defineTool<
  { threadId: string },
  { threadId: string; messages: GmailMessageSummary[] }
>({
  name: "google-workspace-gmail_getThread",
  label: "Get Gmail Thread",
  description: "Get all messages in a Gmail thread to determine reply status",

  params: {
    threadId: { type: "string", required: true, description: "Gmail thread ID" },
  },

  auth: { check: hasNativeGoogleAuth, service: "google" },
  progress: (p) => `Getting thread ${p.threadId}`,

  async execute(p) {
    const thread = (await makeGoogleRequest(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${p.threadId}`,
      { format: "metadata", metadataHeaders: "From,Subject,Date" },
    )) as {
      messages?: Array<{ id: string; snippet: string; payload: { headers: GmailHeader[] } }>;
    };
    const messages: GmailMessageSummary[] = (thread.messages || []).map((msg) => ({
      id: msg.id,
      threadId: p.threadId,
      from: headerValue(msg.payload?.headers || [], "from"),
      subject: headerValue(msg.payload?.headers || [], "subject"),
      date: headerValue(msg.payload?.headers || [], "date"),
      snippet: msg.snippet,
    }));
    return { threadId: p.threadId, messages };
  },

  mcp: {
    server: "google-workspace",
    tool: "gmail_get",
    mapParams: (p) => ({ messageId: p.threadId }),
    mapResult: (raw: unknown) => {
      const r = raw as Record<string, unknown>;
      const tid = String(r.threadId ?? "");
      const rawMsgs = (r.messages as unknown[] | undefined) ?? [];
      return {
        threadId: tid,
        messages: rawMsgs.map((m) => {
          const x = m as Record<string, unknown>;
          return {
            id: String(x.id ?? ""),
            threadId: tid,
            from: String(x.from ?? ""),
            subject: String(x.subject ?? ""),
            date: String(x.date ?? ""),
            snippet: String(x.snippet ?? ""),
          };
        }),
      };
    },
  },

  format(result) {
    if (result.messages.length === 0) return { text: "Empty thread", details: result };
    const lines = result.messages.map(
      (m) =>
        `${m.date?.slice(0, 16) ?? ""} | ${m.from?.slice(0, 40)} | ${m.snippet?.slice(0, 120) ?? ""}`,
    );
    return {
      text: `Thread ${result.threadId} (${result.messages.length} messages)\n${lines.join("\n")}`,
      details: result,
    };
  },
});
