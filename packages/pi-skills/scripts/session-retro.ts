#!/usr/bin/env bun
/**
 * Analyze Pi session jsonl logs for workflow friction and skill gaps.
 *
 * Usage:
 *   bun packages/pi-skills/scripts/session-retro.ts [--json] [--sessions-root PATH] [--since YYYY-MM-DD] [--until YYYY-MM-DD]
 *
 * `--since` keeps sessions whose file name timestamp is on or after the date and `--until` keeps
 * those strictly before it, so a pilot window can be compared with the sessions before it. The `gates` and `adoption` sections measure the
 * checks that the verify, commit, pr, review, worktree and brief skills ask for.
 */

import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_ROOT = join(homedir(), ".config/pi/agent/sessions");

type Args = {
  json: boolean;
  sessionsRoot: string;
  since: string | null;
  until: string | null;
};

function parseArgs(argv: string[]): Args {
  const args: Args = { json: false, sessionsRoot: DEFAULT_ROOT, since: null, until: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") args.json = true;
    else if (arg === "--sessions-root") {
      const value = argv[index + 1];
      if (!value) throw new Error("--sessions-root requires a path");
      args.sessionsRoot = value;
      index += 1;
    } else if (arg === "--since") {
      const value = argv[index + 1];
      if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error("--since requires YYYY-MM-DD");
      }
      args.since = value;
      index += 1;
    } else if (arg === "--until") {
      const value = argv[index + 1];
      if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error("--until requires YYYY-MM-DD");
      }
      args.until = value;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: session-retro.ts [--json] [--sessions-root PATH] [--since YYYY-MM-DD] [--until YYYY-MM-DD]",
      );
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
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
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

/** Session file names start with an ISO timestamp, e.g. `2026-10-08T08-34-13-342Z_<id>.jsonl`. */
function sessionDate(filePath: string): string | null {
  const match = /(\d{4}-\d{2}-\d{2})T/.exec(filePath.split("/").pop() ?? "");
  return match?.[1] ?? null;
}

// Patterns are anchored to the start of one shell segment (see `shellSegments`), so a mention such
// as `echo "git commit"` or `rg 'bun test'` does not count. Bare `test`/`check`/`lint` only count
// behind a package runner, so the shell builtin `test -f x` is not a verification.
const VERIFY_COMMAND =
  /^(?:(?:npx|bunx) )?(?:jest|vitest|pytest|go test|cargo test|tsc|biome check|eslint)\b|^(?:npm|yarn|pnpm|bun)(?: run)? (?:test|check|lint)\b/;
const COMMIT_COMMAND = /^git( -C \S+)? commit\b/;
const PR_COMMAND = /^gh pr (create|edit)\b/;
const CI_COMMAND = /^gh (pr checks|run (view|watch|list))\b/;

type Segment = { text: string; op: "" | "&&" | "||" | ";" | "|" };

/**
 * Split a command line into shell segments on `&&`, `||`, `;`, `|` and newlines, outside quotes,
 * dropping `cd` and `VAR=x` prefixes. `op` is the operator that precedes the segment.
 */
function shellSegments(command: string): Segment[] {
  const segments: Segment[] = [];
  let current = "";
  let quote = "";
  let op: Segment["op"] = "";
  let nextOp: Segment["op"] = "";
  const flush = () => {
    const text = current.trim().replace(/^(\w+=\S+\s+)+/, "");
    if (text && !/^cd\b/.test(text)) segments.push({ text, op });
    current = "";
    op = nextOp;
  };
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    // A backslash escapes the next character outside single quotes (so `it\'s` opens no quote).
    if (char === "\\" && quote !== "'" && index + 1 < command.length) {
      current += char + command[index + 1];
      index += 1;
      continue;
    }
    if (quote) {
      if (char === quote) quote = "";
      current += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      current += char;
      continue;
    }
    const pair = command.slice(index, index + 2);
    if (pair === "&&" || pair === "||") {
      nextOp = pair;
      flush();
      index += 1;
    } else if (char === ";" || char === "|" || char === "\n") {
      nextOp = char === "\n" ? ";" : char;
      flush();
    } else {
      current += char;
    }
  }
  nextOp = "";
  flush();
  return segments;
}

const REWORK_SIGNAL =
  /\b(wrong|revert|still (not|see|seeing|fail|loop|only|return)|you forgot|forgot to|missed|not what i)\b/i;

const args = parseArgs(process.argv.slice(2));
const allFiles = await walkJsonl(args.sessionsRoot);
const files =
  args.since || args.until
    ? allFiles.filter((file) => {
        const date = sessionDate(file);
        if (date === null) return false;
        if (args.since && date < args.since) return false;
        if (args.until && date >= args.until) return false;
        return true;
      })
    : allFiles;

const gates = {
  sessionsWithEdits: 0,
  sessionsEditedNeverVerified: 0,
  commits: 0,
  commitsWithUnverifiedEdits: 0,
  commitsBeforeAnyReview: 0,
  prSubmits: 0,
  sessionsWithPrNoCiCheck: 0,
  firstPromptsUnder100Chars: 0,
  sessionsWithUserPrompt: 0,
  reworkSignals: 0,
};
const adoption = {
  greenMark: 0,
  greenCheck: 0,
  reviewMark: 0,
  wtGuard: 0,
  docVerify: 0,
  adhocBootstrap: 0,
  skillReads: {} as Record<string, number>,
};
const NEW_SKILLS = ["brief", "reuse-scout", "risk-checklist", "doc-verify"];

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
let cdPrefixBash = 0;
const costByProject: Record<string, number> = {};
const costByModel: Record<string, number> = {};
const longSessions: Array<[string, number, number]> = [];

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
  let assistantTurns = 0;
  let model = "unknown";
  let dirty = false;
  let sawEdit = false;
  let everVerified = false;
  let reviewSeen = false;
  let prPending = false;
  let sawFirstPrompt = false;
  const pendingVerifyIds = new Set<string>();

  for (const line of (await readFile(file, "utf8")).split("\n").filter(Boolean)) {
    const event = JSON.parse(line);
    if (event.type === "model_change" && event.modelId) model = String(event.modelId);
    if (event.type !== "message" || !event.message) continue;
    const message = event.message;

    if (message.role === "user") {
      totalUserTurns += 1;
      const text = textFromContent(message.content);
      if (!sawFirstPrompt && text.trim()) {
        sawFirstPrompt = true;
        gates.sessionsWithUserPrompt += 1;
        if (text.trim().length < 100) gates.firstPromptsUnder100Chars += 1;
      }
      if (REWORK_SIGNAL.test(text.slice(0, 400)) && text.length < 600) gates.reworkSignals += 1;
      for (const [label, pattern] of INTENT) {
        if (pattern.test(text)) inc(intentSignals, label);
      }
      if (/\/dev\b/.test(text)) hadDev = true;
    }

    if (message.role === "assistant") {
      assistantTurns += 1;
      const turnCost = Number(message.usage?.cost?.total ?? 0);
      if (turnCost) {
        sessionCost += turnCost;
        costByModel[model] = (costByModel[model] ?? 0) + turnCost;
      }
      if (!Array.isArray(message.content)) continue;
      for (const part of message.content) {
        if (part?.type !== "toolCall") continue;
        totalToolCalls += 1;
        const name = String(part.name ?? "unknown");
        inc(toolCounts, name);
        if (name.startsWith("wt_")) hadWt = true;
        if (name === "subagent") hadSubagent = true;
        if (name.startsWith("dev_")) hadDev = true;
        if (name === "edit" || name === "write") {
          dirty = true;
          sawEdit = true;
        }
        if (name === "repo_verify") {
          // Assume success now (so a later commit in this turn counts as verified); a failed result
          // puts the edits back to unverified below.
          dirty = false;
          if (part.id) pendingVerifyIds.add(String(part.id));
          else everVerified = true;
        }
        if (
          name === "git_review_context" ||
          name === "git_review_tasks" ||
          name === "pr_review_context" ||
          (name === "subagent" &&
            /review-(code|security|test)/.test(JSON.stringify(part.arguments)))
        ) {
          reviewSeen = true;
        }
        if (name === "git_commit_execute") {
          gates.commits += 1;
          if (dirty) gates.commitsWithUnverifiedEdits += 1;
          if (!reviewSeen) gates.commitsBeforeAnyReview += 1;
        }
        if (name === "gh_pr_submit") {
          gates.prSubmits += 1;
          prPending = true;
        }
        if (name === "gh_ci_context") prPending = false;
        if (name === "read") {
          const readPath = String(part.arguments?.path ?? "");
          for (const skill of NEW_SKILLS) {
            if (readPath.includes(`/skills/${skill}/`)) inc(adoption.skillReads, skill);
          }
        }
        if (name === "bash" && part.arguments?.command) {
          const command = String(part.arguments.command).trim();
          let previousWasVerify = false;
          for (const segment of shellSegments(command)) {
            const isVerify = VERIFY_COMMAND.test(segment.text);
            if (isVerify) {
              dirty = false;
              if (part.id) pendingVerifyIds.add(String(part.id));
              else everVerified = true;
            }
            // `verify || git commit` runs the commit only when the verify failed, so that commit
            // is unverified. (`dirty` itself is not changed: `verify || exit 1; git commit` is fine.)
            const commitAfterFailedVerify = previousWasVerify && segment.op === "||";
            previousWasVerify = isVerify;
            if (COMMIT_COMMAND.test(segment.text)) {
              gates.commits += 1;
              if (dirty || commitAfterFailedVerify) gates.commitsWithUnverifiedEdits += 1;
              if (!reviewSeen) gates.commitsBeforeAnyReview += 1;
            }
            if (PR_COMMAND.test(segment.text)) {
              gates.prSubmits += 1;
              prPending = true;
            }
            if (CI_COMMAND.test(segment.text)) prPending = false;
          }
          for (const segment of shellSegments(command)) {
            // Anchored to the start of a segment, like the gates: `rg 'green.sh check'` or
            // `cat wt-guard.sh` only mention the scripts. The script path may be any prefix.
            const text = segment.text.replace(/^(?:bash|sh) /, "");
            if (/^\S*green\.sh mark review\b/.test(text)) adoption.reviewMark += 1;
            else if (/^\S*green\.sh mark\b/.test(text)) adoption.greenMark += 1;
            if (/^\S*green\.sh check\b/.test(text)) adoption.greenCheck += 1;
            if (/^\S*wt-guard\.sh\b/.test(text)) adoption.wtGuard += 1;
            if (/^(?:python3? )?\S*doc-verify\.py\b/.test(text)) adoption.docVerify += 1;
            if (/^accord bootstrap --adhoc\b|^\S*adhoc-id\.sh\b/.test(text)) {
              adoption.adhocBootstrap += 1;
            }
          }
          if (/^rg\b/.test(command)) rgBashInvocations += 1;
          if (/^cd\s+\S+\s*(&&|;)/.test(command)) cdPrefixBash += 1;
          const prefix = command.split(/\s+/).slice(0, 2).join(" ");
          inc(bashPrefixes, prefix.slice(0, 50));
        }
      }
    }

    if (message.role === "toolResult") {
      const callId = String(message.toolCallId ?? "");
      if (callId && pendingVerifyIds.delete(callId)) {
        if (message.isError) dirty = true;
        else everVerified = true;
      }
      const body = textFromContent(message.content);
      if (message.isError || /\b(error|failed|exit code 1)\b/i.test(body.slice(0, 400))) {
        inc(toolErrors, String(message.toolName ?? "unknown"));
      }
    }
  }

  totalCost += sessionCost;
  costByProject[projectFromPath(file)] = (costByProject[projectFromPath(file)] ?? 0) + sessionCost;
  if (assistantTurns > 200)
    longSessions.push([
      file.split("/").pop() ?? file,
      assistantTurns,
      Math.round(sessionCost * 100) / 100,
    ]);
  if (sawEdit) {
    gates.sessionsWithEdits += 1;
    if (!everVerified) gates.sessionsEditedNeverVerified += 1;
  }
  if (prPending) gates.sessionsWithPrNoCiCheck += 1;
  if (hadDev) sessionsWithDev += 1;
  if (hadSubagent) sessionsWithSubagent += 1;
  if (hadWt) sessionsWithWt += 1;
}

const report = {
  sessionsRoot: args.sessionsRoot,
  since: args.since,
  until: args.until,
  sessionFiles: files.length,
  totalUserTurns,
  totalToolCalls,
  avgToolsPerTurn: files.length
    ? Math.round((totalToolCalls / Math.max(totalUserTurns, 1)) * 10) / 10
    : 0,
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
  cdPrefixBash,
  costByProject: top(costByProject, 8).map(([k, v]) => [k, Math.round(v)]),
  costByModel: top(costByModel, 8).map(([k, v]) => [k, Math.round(v)]),
  longSessionCount: longSessions.length,
  longSessions: longSessions.sort((a, b) => b[2] - a[2]).slice(0, 8),
  gates,
  adoption,
  suggestions: [
    gates.commits > 0 && gates.commitsWithUnverifiedEdits / gates.commits > 0.2
      ? "Commits with edits since the last verify — use the verify skill; commit gates on green.sh check"
      : null,
    gates.prSubmits > 0 && gates.sessionsWithPrNoCiCheck > 0
      ? "PRs without a CI check afterwards — pr skill reports gh_ci_context after every submit"
      : null,
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
    (toolCounts.bash ?? 0) > 200 && cdPrefixBash / (toolCounts.bash ?? 1) > 0.3
      ? "Most bash calls start with `cd <dir> &&` — prefer absolute paths, git -C, bun --cwd, or wt_exec"
      : null,
    longSessions.length > 5
      ? `${longSessions.length} sessions over 200 turns — compact or start a fresh session per phase`
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
  console.log("\nCost by model:", report.costByModel.map(([k, v]) => `${k} $${v}`).join(", "));
  console.log("Cost by project:", report.costByProject.map(([k, v]) => `${k} $${v}`).join(", "));
  console.log(`Long sessions (>200 turns): ${report.longSessionCount}`);
  const pct = (part: number, whole: number): string =>
    whole > 0 ? `${Math.round((part / whole) * 100)}%` : "n/a";
  console.log(
    `\nGates${args.since ? ` since ${args.since}` : ""}${args.until ? ` until ${args.until}` : ""} (heuristic: command text and tool order, not outcomes):` +
      `\n  edited, never verified: ${gates.sessionsEditedNeverVerified}/${gates.sessionsWithEdits} sessions (${pct(gates.sessionsEditedNeverVerified, gates.sessionsWithEdits)})` +
      `\n  commits with unverified edits: ${gates.commitsWithUnverifiedEdits}/${gates.commits} (${pct(gates.commitsWithUnverifiedEdits, gates.commits)})` +
      `\n  commits before any review: ${gates.commitsBeforeAnyReview}/${gates.commits} (${pct(gates.commitsBeforeAnyReview, gates.commits)})` +
      `\n  sessions with PR and no CI check after: ${gates.sessionsWithPrNoCiCheck} (PR submits ${gates.prSubmits})` +
      `\n  first prompts under 100 chars: ${gates.firstPromptsUnder100Chars}/${gates.sessionsWithUserPrompt} (${pct(gates.firstPromptsUnder100Chars, gates.sessionsWithUserPrompt)})` +
      `\n  rework signals in prompts: ${gates.reworkSignals}`,
  );
  console.log(
    `Adoption: green.sh mark/check/review-mark ${adoption.greenMark}/${adoption.greenCheck}/${adoption.reviewMark}, wt-guard ${adoption.wtGuard}, doc-verify ${adoption.docVerify}, adhoc ${adoption.adhocBootstrap}, skill reads ${JSON.stringify(adoption.skillReads)}`,
  );
  console.log("\nSuggestions:");
  for (const line of report.suggestions) console.log(`  - ${line}`);
}
