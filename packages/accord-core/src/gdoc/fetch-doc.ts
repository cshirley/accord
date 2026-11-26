import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { getGoogleAccessToken } from "./auth.js";
import { extractDocumentId, sanitizeFilename } from "./extract-id.js";
import { htmlToMarkdown, plainTextToMarkdown } from "./html-to-markdown.js";
import { withMcpClient } from "./mcp-client.js";

export interface GdocExportResult {
  documentId: string;
  title?: string;
  outputPath: string;
  source: "markdown-export" | "mcp-text" | "html-export";
  bytes: number;
}

export interface GdocExportOptions {
  documentId: string;
  outputPath?: string;
  cwd: string;
  tabId?: string;
}

async function exportViaDrive(
  documentId: string,
  accessToken: string,
  mimeType: "text/markdown" | "text/html",
): Promise<string> {
  const url = new URL(`https://www.googleapis.com/drive/v3/files/${documentId}/export`);
  url.searchParams.set("mimeType", mimeType);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(
      `Drive ${mimeType} export failed (${response.status}): ${await response.text()}`,
    );
  }
  return response.text();
}

function extractTitleFromMarkdown(markdown: string): string | undefined {
  const match = markdown.match(/^#\s+(?:\*\*)?(.+?)(?:\*\*)?\s*$/m);
  return match?.[1]?.replace(/\\/g, "").trim();
}

async function fetchViaMcp(documentId: string, tabId?: string): Promise<string> {
  return withMcpClient(async (client) => {
    const args: Record<string, unknown> = { documentId };
    if (tabId) args.tabId = tabId;
    return client.callText("docs_getText", args);
  });
}

function resolveOutputPath(
  title: string | undefined,
  documentId: string,
  outputPath: string | undefined,
  cwd: string,
): string {
  if (outputPath) {
    return isAbsolute(outputPath) ? outputPath : resolve(cwd, outputPath);
  }
  const base = title ? sanitizeFilename(title) : documentId;
  return resolve(cwd, `${base}.md`);
}

export async function exportGoogleDocToMarkdown(
  options: GdocExportOptions,
): Promise<GdocExportResult> {
  const documentId = extractDocumentId(options.documentId);
  let markdown = "";
  let title: string | undefined;
  let source: GdocExportResult["source"] = "mcp-text";

  const accessToken = await getGoogleAccessToken();

  // Per-tab export is only available via Docs API (MCP plain text).
  if (options.tabId) {
    const text = await fetchViaMcp(documentId, options.tabId);
    if (text.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(text) as { error?: string };
        if (parsed.error) throw new Error(parsed.error);
      } catch (e) {
        if (e instanceof SyntaxError) {
          /* not JSON error payload */
        } else {
          throw e;
        }
      }
    }
    const converted = plainTextToMarkdown(text);
    markdown = converted.markdown;
    title = converted.title;
    source = "mcp-text";
  } else if (accessToken) {
    try {
      markdown = await exportViaDrive(documentId, accessToken, "text/markdown");
      title = extractTitleFromMarkdown(markdown);
      source = "markdown-export";
    } catch {
      /* fall through */
    }
  }

  if (!markdown) {
    const text = await fetchViaMcp(documentId, options.tabId);
    if (text.trim().startsWith("{")) {
      try {
        const parsed = JSON.parse(text) as { error?: string };
        if (parsed.error) throw new Error(parsed.error);
      } catch (e) {
        if (e instanceof SyntaxError) {
          /* not JSON error payload */
        } else {
          throw e;
        }
      }
    }
    const converted = plainTextToMarkdown(text);
    markdown = converted.markdown;
    title = converted.title;
    source = "mcp-text";
  }

  if (!markdown && accessToken) {
    try {
      const html = await exportViaDrive(documentId, accessToken, "text/html");
      markdown = htmlToMarkdown(html);
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      title = titleMatch?.[1]?.trim();
      source = "html-export";
    } catch {
      /* no further fallback */
    }
  }

  if (!markdown.trim()) {
    throw new Error("Document is empty or could not be converted.");
  }

  const outputPath = resolveOutputPath(title, documentId, options.outputPath, options.cwd);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, markdown, "utf-8");

  return {
    documentId,
    title,
    outputPath,
    source,
    bytes: Buffer.byteLength(markdown, "utf-8"),
  };
}
