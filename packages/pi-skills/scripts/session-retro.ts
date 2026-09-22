#!/usr/bin/env bun
/**
 * Analyze Pi session jsonl logs for workflow friction and skill gaps.
 *
 * Usage:
 *   bun packages/pi-skills/scripts/session-retro.ts [--json] [--sessions-root PATH]
 */

import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_ROOT = join(homedir(), ".config/pi/agent/sessions");

type Args = { json: boolean; sessionsRoot: string };

function parseArgs(argv: string[]): Args {
  const args: Args = { json: false, sessionsRoot: DEFAULT_ROOT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") args.json = true;
    else if (arg === "--sessions-root") {
      const value = argv[index + 1];
      if (!value) throw new Error("--sessions-root requires a path");
      args.sessionsRoot = value;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: session-retro.ts [--json] [--sessions-root PATH]");
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function walkJsonl(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walkJsonl(path)));
    else if (entry.name.endsWith(".jsonl")) files.push(path);
  }
  return files;
}

function inc(map: Record<string, number>, key: string, amount = 1): void {
  map[key] = (map[key] ?? 0) + amount;
}

function top(map: Record<string, number>, limit = 20): Array<[string, number]> {
  return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, limit);
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part) => part && typeof part === "object" && part.type === "text")
    .map((part) => String(part.text ?? ""))
    .join("\n");
}

function projectFromPath(filePath: string): string {
  const segment = filePath.split("/sessions/")[1]?.split("/")[0] ?? "unknown";
  return segment.replace(/^--/, "").replace(/--$/, "").replace(/--/g, "/");
}

const args = parseArgs(process.argv.slice(2));
const files = await walkJsonl(args.sessionsRoot);

const toolCounts: Record<string, number> = {};
const toolErrors: Record<string, number> = {};
const intentSignals: Record<string, number> = {};
const projectCounts: Record<string, number> = {};
const bashPrefixes: Record<string, number> = {};
let totalUserTurns = 0;
let totalToolCalls = 0;
let totalCost = 0;
let sessionsWithDev = 0;
let sessionsWithSubagent = 0;
let sessionsWithWt = 0;
let rgBashInvocations = 0;

const INTENT: Array<[string, RegExp]> = [
  ["fix", /\b(fix|broken|bug|failing)\b/i],
  ["implement", /\b(implement|add|create)\b/i],
  ["verify", /\b(test|verify|lint|coverage)\b/i],
  ["pr_ci", /\b(pr|ci|checks|merge)\b/i],
  ["review", /\breview\b/i],
  ["dev_harness", /\/dev\b/i],
];

for (const file of files) {
  inc(projectCounts, projectFromPath(file));
  let hadDev = false;
  let hadSubagent = false;
  let hadWt = false;
  let sessionCost = 0;

  for (const line of (await readFile(file, "utf8")).split("\n").filter(Boolean)) {
    const event = JSON.parse(line);
    if (event.type !== "message" || !event.message) continue;
    const message = event.message;

    if (message.role === "user") {
      totalUserTurns += 1;
      const text = textFromContent(message.content);
      for (const [label, pattern] of INTENT) {
        if (pattern.test(text)) inc(intentSignals, label);
      }
      if (/\/dev\b/.test(text)) hadDev = true;
    }

    if (message.role === "assistant") {
      if (message.usage?.cost?.total) sessionCost += message.usage.cost.total;
      if (!Array.isArray(message.content)) continue;
      for (const part of message.content) {
        if (part?.type !== "toolCall") continue;
        totalToolCalls += 1;
        const name = String(part.name ?? "unknown");
        inc(toolCounts, name);
        if (name.startsWith("wt_")) hadWt = true;
        if (name === "subagent") hadSubagent = true;
        if (name.startsWith("dev_")) hadDev = true;
        if (name === "bash" && part.arguments?.command) {
          const command = String(part.arguments.command).trim();
          if (/^rg\b/.test(command)) rgBashInvocations += 1;
          const prefix = command.split(/\s+/).slice(0, 2).join(" ");
          inc(bashPrefixes, prefix.slice(0, 50));
        }
      }
    }

    if (message.role === "toolResult") {
      const body = textFromContent(message.content);
      if (message.isError || /\b(error|failed|exit code 1)\b/i.test(body.slice(0, 400))) {
        inc(toolErrors, String(message.toolName ?? "unknown"));
      }
    }
  }

  totalCost += sessionCost;
  if (hadDev) sessionsWithDev += 1;
  if (hadSubagent) sessionsWithSubagent += 1;
  if (hadWt) sessionsWithWt += 1;
}

const report = {
  sessionsRoot: args.sessionsRoot,
  sessionFiles: files.length,
  totalUserTurns,
  totalToolCalls,
  avgToolsPerTurn: files.length ? Math.round((totalToolCalls / Math.max(totalUserTurns, 1)) * 10) / 10 : 0,
  estimatedCostUsd: Math.round(totalCost * 100) / 100,
  sessionsWithDev,
  sessionsWithSubagent,
  sessionsWithWt,
  topProjects: top(projectCounts, 10),
  topTools: top(toolCounts, 20),
  toolErrors: top(toolErrors, 12),
  intentSignals: top(intentSignals, 10),
  topBashPrefixes: top(bashPrefixes, 15),
  rgBashInvocations,
  suggestions: [
    (toolCounts.bash ?? 0) > 500 && (toolErrors.bash ?? 0) / (toolCounts.bash ?? 1) > 0.12
      ? "High bash error rate — triage failed rg/cd/gh (pi.dev prefers rg in bash; do not push read/grep tool over rg)"
      : null,
    (toolCounts.grep ?? 0) > 30 && rgBashInvocations > (toolCounts.grep ?? 0) * 5
      ? "Dedicated grep tool used alongside heavy rg — prefer bash rg per pi.dev"
      : null,
    (toolCounts.bash ?? 0) > 500 && (toolCounts.repo_verify ?? 0) < 5
      ? "Many bash runs, few repo_verify — use /verify skill"
      : null,
    sessionsWithWt < files.length * 0.05
      ? "Low wt_* usage — use /worktree + git_worktree_resolve"
      : null,
    (bashPrefixes["gh run"] ?? 0) + (bashPrefixes["gh pr checks"] ?? 0) > 10
      ? "Repeated gh CI commands — use gh_ci_context + /ci-debug"
      : null,
  ].filter(Boolean),
};

if (args.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`Pi session retro (${report.sessionFiles} files)\n`);
  console.log(
    `Turns: ${report.totalUserTurns}  Tools: ${report.totalToolCalls}  ~$${report.estimatedCostUsd}  dev/subagent/wt sessions: ${report.sessionsWithDev}/${report.sessionsWithSubagent}/${report.sessionsWithWt}\n`,
  );
  console.log("Top tools:", report.topTools.map(([k, v]) => `${k}(${v})`).join(", "));
  console.log("\nSuggestions:");
  for (const line of report.suggestions) console.log(`  - ${line}`);
}
