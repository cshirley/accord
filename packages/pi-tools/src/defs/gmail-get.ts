import { defineTool } from "../framework.js";
import {
  makeGoogleRequest, hasNativeGoogleAuth, headerValue,
  type GmailHeader,
} from "../services/google.client.js";

interface GmailMessageDetail {
  id: string; threadId: string;
  from: string; to: string; subject: string; date: string;
  snippet: string; labelIds: string[];
  body: unknown;
}

export default defineTool<
  { messageId: string; format?: string },
  GmailMessageDetail
>({
  name: "google-workspace-gmail_get",
  label: "Get Gmail Message",
  description: "Get full details of a Gmail message by ID",

  params: {
    messageId: { type: "string", required: true, description: "Gmail message ID" },
    format:    { type: "string", default: "full", description: "Response format: full, metadata, minimal" },
  },

  auth: { check: hasNativeGoogleAuth, service: "google" },
  progress: (p) => `Getting message ${p.messageId}`,

  async execute(p) {
    const msg = await makeGoogleRequest(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${p.messageId}`,
      { format: p.format || "full" },
    ) as { id: string; threadId: string; snippet: string; labelIds: string[]; payload: { headers: GmailHeader[] } & Record<string, unknown> };
    const headers = msg.payload?.headers || [];
    return {
      id: msg.id, threadId: msg.threadId,
      from: headerValue(headers, "from"), to: headerValue(headers, "to"),
      subject: headerValue(headers, "subject"), date: headerValue(headers, "date"),
      snippet: msg.snippet, labelIds: msg.labelIds,
      body: msg.payload,
    };
  },

  mcp: {
    server: "google-workspace",
    tool: "gmail_get",
    mapParams: (p) => ({ messageId: p.messageId }),
    mapResult: (raw: any) => ({
      id: raw.id ?? "", threadId: raw.threadId ?? "",
      from: raw.from ?? "", to: raw.to ?? "",
      subject: raw.subject ?? "", date: raw.date ?? "",
      snippet: raw.snippet ?? "", labelIds: raw.labelIds ?? [],
      body: raw.body ?? raw.payload ?? null,
    }),
  },

  format(msg) {
    const lines = [
      `From: ${msg.from} | To: ${msg.to}`,
      `Subject: ${msg.subject}`,
      `Date: ${msg.date}`,
      `Snippet: ${msg.snippet?.slice(0, 300) ?? ""}`,
    ];
    return {
      text: lines.join("\n"),
      details: msg as unknown as Record<string, unknown>,
    };
  },
});
