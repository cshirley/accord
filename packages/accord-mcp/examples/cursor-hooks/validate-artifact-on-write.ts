#!/usr/bin/env bun
/**
 * Cursor hook example — validate harness JSON on write/edit.
 *
 * Wire from `.cursor/hooks.json` (afterToolCall) pointing at this script.
 * Expects JSON on stdin: `{ "tool": "write"|"edit", "input": { "path": "..." } }`
 */
import { runArtifactWriteHook } from "@clive.shirley/accord-core/harness/lifecycle-wiring.js";

const raw = await Bun.stdin.text();
let payload: { tool?: string; input?: { path?: string } };
try {
  payload = JSON.parse(raw || "{}");
} catch {
  console.error(JSON.stringify({ block: true, message: "Invalid hook payload JSON" }));
  process.exit(1);
}

if (payload.tool !== "write" && payload.tool !== "edit") {
  process.exit(0);
}

const result = await runArtifactWriteHook(payload.input?.path);
if (!result.ok) {
  console.log(JSON.stringify({ block: true, message: result.message }));
  process.exit(0);
}

process.exit(0);
