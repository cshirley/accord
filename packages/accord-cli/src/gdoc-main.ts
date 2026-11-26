#!/usr/bin/env bun
/**
 * gdoc-md — export a Google Doc to Markdown.
 *
 *   gdoc-md <url|id> [-o out.md] [--tab <tabId>] [--json]
 */

import { exportGoogleDocToMarkdown } from "@clive.shirley/accord-core/gdoc/index.js";

async function main(argv: string[]): Promise<number> {
  let doc: string | undefined;
  let output: string | undefined;
  let tabId: string | undefined;
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o" || a === "--output") output = argv[++i];
    else if (a === "--tab") tabId = argv[++i];
    else if (a === "--json") json = true;
    else if (!doc) doc = a;
    else if (!output) output = a;
  }
  if (!doc) {
    console.error("Usage: gdoc-md <url|id> [-o out.md] [--tab <tabId>] [--json]");
    return 64;
  }
  try {
    const result = await exportGoogleDocToMarkdown({
      documentId: doc,
      outputPath: output,
      tabId,
      cwd: process.cwd(),
    });
    console.log(
      json
        ? JSON.stringify(result)
        : `Saved ${result.outputPath} (${result.source}, ${result.bytes} bytes)`,
    );
    return 0;
  } catch (error) {
    console.error(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

process.exit(await main(process.argv.slice(2)));
