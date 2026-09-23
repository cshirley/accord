#!/usr/bin/env bun
/**
 * Cursor hook example — subagent result processing (usage + post-code verify).
 *
 * Wire from `.cursor/hooks.json` (afterToolCall) for `subagent` tool results.
 * Expects JSON on stdin: `{ "tool": "subagent", "details": { ... } }`
 */
import { loadDevHarnessConfig } from "@clive.shirley/accord-core/config/index.js";
import {
  createNoopHarnessLifecycleHost,
  runSubagentResultHook,
} from "@clive.shirley/accord-core/harness/lifecycle-wiring.js";
import { loadPricing } from "@clive.shirley/accord-core/telemetry/usage.js";
import type { HarnessMutableState } from "@clive.shirley/accord-core/types/host.js";

const raw = await Bun.stdin.text();
let payload: { tool?: string; details?: unknown };
try {
  payload = JSON.parse(raw || "{}");
} catch {
  console.error(JSON.stringify({ error: "Invalid hook payload JSON" }));
  process.exit(1);
}

if (payload.tool !== "subagent") {
  process.exit(0);
}

const cwd = process.env.ACCORD_CWD?.trim() || process.cwd();
const devConfig = loadDevHarnessConfig(cwd);
const state: HarnessMutableState = {
  devConfig,
  costCache: new Map(),
  sessionCost: 0,
  activeWorkItem: null,
};

const append = await runSubagentResultHook(payload.details, {
  host: createNoopHarnessLifecycleHost(),
  state,
  devConfig,
  pricing: loadPricing(),
});

if (append.trim()) {
  console.log(JSON.stringify({ contentAppend: append }));
}
