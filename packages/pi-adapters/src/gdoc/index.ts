/**
 * Google Doc → Markdown export for pi.
 *
 * Downloads a Google Doc as Markdown via Drive native markdown export,
 * with MCP docs_getText and HTML export fallbacks.
 *
 * Usage:
 *   /gdoc-md <doc-url-or-id> [output.md]
 *
 * Tool:
 *   google_doc_to_markdown
 */

import { exportGoogleDocToMarkdown } from "@clive.shirley/accord-core/gdoc/index.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

function splitCommandArgs(args: string): { doc: string; output?: string } {
  const trimmed = args.trim();
  if (!trimmed) return { doc: "" };

  // Allow quoted output path: /gdoc-md <url> "./My Notes.md"
  const quoted = trimmed.match(/^(\S+)\s+("([^"]+)"|'([^']+)')$/);
  if (quoted) {
    return { doc: quoted[1], output: quoted[3] ?? quoted[4] };
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { doc: parts[0] };
  return { doc: parts[0], output: parts.slice(1).join(" ") };
}

export default function googleDocMarkdown(pi: ExtensionAPI): void {
  pi.registerCommand("gdoc-md", {
    description: "Export a Google Doc to Markdown and save locally",
    handler: async (args, ctx) => {
      const { doc, output } = splitCommandArgs(args);
      if (!doc) {
        ctx.ui.notify("Usage: /gdoc-md <doc-url-or-id> [output.md]", "warning");
        return;
      }

      try {
        const result = await exportGoogleDocToMarkdown({
          documentId: doc,
          outputPath: output,
          cwd: ctx.cwd,
        });
        const via =
          result.source === "markdown-export"
            ? "Markdown export"
            : result.source === "html-export"
              ? "HTML export"
              : "MCP text";
        ctx.ui.notify(`Saved ${result.outputPath} (${via}, ${result.bytes} bytes)`, "info");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui.notify(`Export failed: ${message}`, "error");
      }
    },
  });

  pi.registerTool({
    exposure: "deferred",
    name: "google_doc_to_markdown",
    label: "Google Doc → Markdown",
    description:
      "Export a Google Doc to a local Markdown file. Accepts a Google Docs URL or document ID. Uses Drive native markdown export when google-workspace auth is available; falls back to plain text via MCP, then HTML export.",
    parameters: Type.Object({
      documentId: Type.String({
        description: "Google Docs URL or document ID",
      }),
      outputPath: Type.Optional(
        Type.String({
          description:
            "Local output path (.md). Defaults to <title>.md in the current working directory.",
        }),
      ),
      tabId: Type.Optional(
        Type.String({
          description: "Optional Google Docs tab ID for multi-tab documents",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      try {
        const result = await exportGoogleDocToMarkdown({
          documentId: params.documentId,
          outputPath: params.outputPath,
          tabId: params.tabId,
          cwd: ctx.cwd,
        });
        return {
          content: [
            {
              type: "text",
              text: [
                `Exported Google Doc to Markdown.`,
                `Path: ${result.outputPath}`,
                `Source: ${result.source}`,
                result.title ? `Title: ${result.title}` : undefined,
                `Bytes: ${result.bytes}`,
              ]
                .filter(Boolean)
                .join("\n"),
            },
          ],
          details: result,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text", text: `Export failed: ${message}` }],
          details: { error: message },
          isError: true,
        };
      }
    },
  });
}
