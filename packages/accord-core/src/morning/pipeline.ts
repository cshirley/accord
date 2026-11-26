/**
 * Morning briefing core (host-neutral; pi adapter and `accord-morning` CLI wrap this)
 *
 * A self-contained composite tool that assembles the entire morning briefing
 * deterministically in code, so a weak (local) model never has to:
 *   • compute or propagate the date        (hallucination risk)
 *   • fan out ~10 tool calls               (dropped-call risk)
 *   • build document structure / JSON       (malformed-output risk)
 *
 * Data sources:
 *   • Jira (active / backlog / watched) and Slack mentions — talked to directly
 *     over HTTP using the same env/service-auth creds the accord tools use.
 *   • Calendar + Gmail — obtained by REUSING the existing `google-workspace`
 *     MCP server. This extension acts as a tiny MCP stdio client: it reads the
 *     server command straight from pi's mcp.json, spawns it, and calls
 *     `calendar_listEvents` / `gmail_search` / `gmail_get`. The spawned server
 *     transparently reuses its persisted OAuth (keychain / encrypted file) and
 *     refreshes tokens via its cloud-function proxy — no login prompt, no
 *     duplicated Google auth in this extension.
 *
 * Prefer `morning-run` for the daily workflow — it gathers, writes the journal,
 * and emails weekly objectives in one deterministic call.
 *
 * The date is computed here with `new Date()` and is deliberately NOT something
 * the model chooses.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  buildDriveQuery,
  buildGmailQuery,
  buildSlackQueries,
  getConfig,
  type MorningConfig,
  normalizeChannel,
} from "./config.js";
import {
  buildWeekObjectives,
  computePreviousWeekRecap,
  extractWeekObjectives,
  formatLastWeekRecapBlock,
} from "./weekly-carry-over.js";
import { writeJournalEntry } from "./write-entry.js";

// ---------------------------------------------------------------------------
// Config
//
// Jira queries, Slack/Gmail/calendar/Drive filters and the objectives-email
// details all live in config.ts, which merges an optional JSON file over
// built-in defaults. Only structural values stay here.
// ---------------------------------------------------------------------------

const GW_MCP_SERVER = "google-workspace";

const AUTH_FILE =
  process.env.AI_TOOLS_AUTH_PATH ?? join(homedir(), ".pi", "agent", "service-auth.json");

// Where the assembled journalPayload is persisted for debugging (optional handoff file).
// Overwritten every run and safe to delete; not to be confused with the config file,
// morning-briefing.json.
const PAYLOAD_DIR = join(homedir(), ".pi", "agent");
const PAYLOAD_FILE = join(PAYLOAD_DIR, "morning-briefing.tmp.json");

// Line-manager weekly-objectives email. Recipient, salutation and sign-off come
// from the `email` section of the config. The state file guarantees the email is
// sent at most once per ISO week (idempotent no-op on re-runs / mid-week runs).

/** Title-case the first name from an email local-part, e.g. "olly.mayes" -> "Olly". */
function nameFromEmail(email: string): string {
  const first = (email.split("@")[0] || "").split(/[._-]/)[0] || "";
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : "there";
}

const WEEK_EMAIL_STATE_FILE = join(PAYLOAD_DIR, "week-objectives-emailed.json");

// ---------------------------------------------------------------------------
// Auth store (self-contained; matches accord's service-auth.json layout)
// Jira/Slack resolve from this store or from env vars.
// ---------------------------------------------------------------------------

interface AuthStore {
  jira?: { email: string; apiToken: string; baseUrl: string };
  slack?: { token: string; userId?: string };
}

function loadAuth(): AuthStore {
  if (!existsSync(AUTH_FILE)) return {};
  try {
    return JSON.parse(readFileSync(AUTH_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function getJiraAuth(): { email: string; apiToken: string; baseUrl: string } | null {
  const auth = loadAuth();
  if (auth.jira) return auth.jira;
  const email = process.env.JIRA_EMAIL;
  const apiToken = process.env.JIRA_API_KEY;
  if (email && apiToken) {
    return { email, apiToken, baseUrl: process.env.JIRA_BASE_URL ?? getConfig().jira.baseUrl };
  }
  return null;
}

function getSlackAuth(): { token: string; userId?: string } | null {
  const auth = loadAuth();
  if (auth.slack) return auth.slack;
  const envToken = process.env.SLACK_BOT_TOKEN;
  if (envToken) return { token: envToken };
  return null;
}

function basicAuthHeader(email: string, token: string): string {
  return `Basic ${Buffer.from(`${email}:${token}`).toString("base64")}`;
}

// ---------------------------------------------------------------------------
// Jira + Slack HTTP clients
// ---------------------------------------------------------------------------

async function makeJiraRequest(
  endpoint: string,
  params?: Record<string, string | number>,
): Promise<unknown> {
  const auth = getJiraAuth();
  if (!auth) throw new Error("Jira not configured.");
  const url = new URL(`${auth.baseUrl}/rest/api/3/${endpoint}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.append(k, String(v));
    }
  }
  const response = await fetch(url.toString(), {
    headers: {
      Authorization: basicAuthHeader(auth.email, auth.apiToken),
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`Jira API error (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

async function makeSlackRequest<T = Record<string, unknown>>(
  endpoint: string,
  params?: Record<string, unknown>,
): Promise<T> {
  const auth = getSlackAuth();
  if (!auth) throw new Error("Slack not configured.");
  const url = new URL(`https://slack.com/api/${endpoint}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.append(k, String(v));
    }
  }
  const response = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${auth.token}` },
  });
  if (!response.ok) throw new Error(`Slack API HTTP error (${response.status})`);
  const data = (await response.json()) as Record<string, unknown> & {
    ok: boolean;
    error?: string;
  };
  if (!data.ok) throw new Error(`Slack API error: ${data.error || "unknown"}`);
  return data as T;
}

// ---------------------------------------------------------------------------
// Minimal MCP stdio client — reuse the existing google-workspace MCP server.
//
// Speaks newline-delimited JSON-RPC 2.0 over the child's stdio (the framing the
// gemini-workspace-server uses). No external dependency; we only need
// initialize + tools/call.
// ---------------------------------------------------------------------------

interface McpServerCfg {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/**
 * Read a server definition from pi's built-in mcp.json so command/args/env
 * stay DRY. Both candidates resolve to the same file (~/.pi is a symlink to
 * ~/.config/pi); kept as two in case that symlink is ever absent. A server's
 * `enabled: false` only hides it from pi's in-session MCP gateway — we still
 * spawn it directly here regardless of that flag.
 */
const MCP_CONFIG_CANDIDATES = [
  join(homedir(), ".config", "pi", "agent", "mcp.json"),
  join(homedir(), ".pi", "agent", "mcp.json"),
];

function readMcpServer(name: string): McpServerCfg | null {
  const candidates = MCP_CONFIG_CANDIDATES;
  for (const p of candidates) {
    try {
      if (!existsSync(p)) continue;
      const cfg = JSON.parse(readFileSync(p, "utf-8")) as {
        mcpServers?: Record<string, McpServerCfg>;
      };
      const s = cfg.mcpServers?.[name];
      if (s?.command && Array.isArray(s.args)) {
        return { command: s.command, args: s.args, env: s.env };
      }
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

interface McpRpcMessage {
  id?: number | string;
  result?: { content?: Array<{ type?: string; text?: string }>; isError?: boolean };
  error?: { message?: string };
}

class McpStdioClient {
  private child: ReturnType<typeof spawn>;
  private buf = "";
  private pending = new Map<number, (m: McpRpcMessage) => void>();
  private nextId = 1;

  constructor(cfg: McpServerCfg) {
    this.child = spawn(cfg.command, cfg.args, {
      env: { ...process.env, ...(cfg.env || {}) },
      stdio: ["pipe", "pipe", "pipe"],
    });
    // Swallow spawn/pipe errors; failures surface as request timeouts and are
    // handled gracefully by the caller.
    this.child.on("error", () => {});
    this.child.stdout?.on("data", (d: Buffer) => this.onData(d));
  }

  private onData(d: Buffer): void {
    this.buf += d.toString();
    for (let i = this.buf.indexOf("\n"); i >= 0; i = this.buf.indexOf("\n")) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (!line) continue;
      let msg: McpRpcMessage;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id != null && this.pending.has(msg.id as number)) {
        const resolve = this.pending.get(msg.id as number);
        this.pending.delete(msg.id as number);
        resolve?.(msg);
      }
    }
  }

  private request(method: string, params: unknown, timeoutMs = 30000): Promise<McpRpcMessage> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, resolve);
      this.child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`MCP timeout: ${method}`));
        }
      }, timeoutMs);
    });
  }

  private notify(method: string, params: unknown): void {
    this.child.stdin?.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
  }

  async initialize(): Promise<void> {
    await this.request(
      "initialize",
      {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "morning-briefing", version: "1" },
      },
      20000,
    );
    this.notify("notifications/initialized", {});
  }

  /** Call a tool and JSON-parse its text content. */
  async callJson<T>(name: string, args: Record<string, unknown>): Promise<T> {
    const r = await this.request("tools/call", { name, arguments: args });
    if (r.error) throw new Error(r.error.message || `MCP error: ${name}`);
    if (r.result?.isError) throw new Error(`MCP tool error: ${name}`);
    const text = (r.result?.content || []).map((c) => c.text || "").join("");
    const parsed = JSON.parse(text) as unknown;
    // gemini-workspace-server reports failures (e.g. expired OAuth) as a normal
    // result with body {"error": "..."} rather than isError — treat as a throw.
    if (
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      typeof (parsed as { error?: unknown }).error === "string" &&
      Object.keys(parsed).length === 1
    ) {
      throw new Error(`${name}: ${(parsed as { error: string }).error}`);
    }
    return parsed as T;
  }

  /** Call a tool and return its raw text content (for tools whose output isn't JSON). */
  async callText(name: string, args: Record<string, unknown>): Promise<string> {
    const r = await this.request("tools/call", { name, arguments: args });
    if (r.error) throw new Error(r.error.message || `MCP error: ${name}`);
    if (r.result?.isError) {
      const errText = (r.result?.content || []).map((c) => c.text || "").join("");
      throw new Error(`MCP tool error: ${name}${errText ? ` — ${errText}` : ""}`);
    }
    return (r.result?.content || []).map((c) => c.text || "").join("");
  }

  close(): void {
    try {
      this.child.kill("SIGKILL");
    } catch {
      /* ignore */
    }
  }
}

// ---------------------------------------------------------------------------
// Domain types + mappers
// ---------------------------------------------------------------------------

interface JiraIssueRaw {
  key: string;
  fields?: { summary?: string; status?: { name?: string }; updated?: string };
}
interface MappedIssue {
  key: string;
  summary: string;
  status: string;
  updated: string;
}
interface CalendarEvent {
  eventType?: string;
  summary?: string;
  htmlLink?: string;
  attendees?: Array<{ self?: boolean; responseStatus?: string }>;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}
interface GmailMsg {
  id: string;
  threadId: string;
  from: string;
  subject: string;
}
interface DriveFile {
  id: string;
  name: string;
  mimeType?: string;
  modifiedTime?: string;
  /** Absent when you have never opened the file. */
  viewedByMeTime?: string;
}
interface SlackMatch {
  text: string;
  user: string;
  channel: { id: string; name?: string };
  permalink: string;
  ts?: string;
}

const JIRA_FIELDS = "summary,status,priority,issuetype,project,updated,assignee";

function mapIssue(issue: JiraIssueRaw): MappedIssue {
  return {
    key: issue.key,
    summary: issue.fields?.summary ?? "",
    status: issue.fields?.status?.name ?? "",
    updated: issue.fields?.updated?.slice(0, 10) ?? "",
  };
}

function filterCalendarEvents(events: CalendarEvent[]): CalendarEvent[] {
  const skip = new Set(getConfig().calendar.skipSummaries);
  return events.filter((ev) => {
    if (ev.eventType === "workingLocation") return false;
    const summary = (ev.summary || "").trim().toLowerCase();
    if (skip.has(summary) && !ev.attendees?.length) return false;
    const me = (ev.attendees || []).find((a) => a.self);
    if (me?.responseStatus === "declined") return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Gather functions
// ---------------------------------------------------------------------------

async function jiraSearch(jql: string, maxResults: number): Promise<MappedIssue[]> {
  const resp = (await makeJiraRequest("search/jql", {
    jql,
    maxResults,
    fields: JIRA_FIELDS,
  })) as { issues?: JiraIssueRaw[] };
  return (resp.issues ?? []).map(mapIssue);
}

async function slackMentions(query: string, count: number): Promise<SlackMatch[]> {
  const resp = await makeSlackRequest<{ messages?: { matches?: SlackMatch[] } }>(
    "search.messages",
    { query, sort: "timestamp", sort_dir: "desc", count, highlight: true },
  );
  return resp.messages?.matches ?? [];
}

/**
 * Run every Slack search and merge the results, newest first. A message can match
 * more than one query (a channel mention matches both the mention search and that
 * channel's search), so results are de-duplicated by permalink. One failing query
 * does not sink the others.
 */
async function gatherSlack(queries: string[], count: number): Promise<SlackMatch[]> {
  const results = await Promise.all(
    queries.map((q) => slackMentions(q, count).catch(() => [] as SlackMatch[])),
  );
  const byPermalink = new Map<string, SlackMatch>();
  for (const m of results.flat()) {
    const key = m.permalink || `${m.channel?.id}:${m.ts}`;
    if (!byPermalink.has(key)) byPermalink.set(key, m);
  }
  return [...byPermalink.values()].sort((a, b) => Number(b.ts ?? 0) - Number(a.ts ?? 0));
}

interface GoogleData {
  events: CalendarEvent[];
  gmail: GmailMsg[];
  docs: DriveFile[];
  /** Per-call failures (calendar/gmail/drive); non-empty means partial or no data. */
  errors?: string[];
}

/** A doc is worth reviewing if you've never opened it, or it changed since you last did. */
function needsReview(f: DriveFile): boolean {
  if (!f.viewedByMeTime) return true;
  if (!f.modifiedTime) return false;
  return new Date(f.modifiedTime) > new Date(f.viewedByMeTime);
}

/**
 * Gather Calendar + Gmail by spawning the google-workspace MCP server and
 * calling its tools. Reuses the server's persisted OAuth (no login prompt).
 * Caps Gmail detail lookups to keep round-trips bounded.
 */
async function gatherGoogle(dateIso: string, gmailQuery: string): Promise<GoogleData> {
  const conf = getConfig();
  const cfg = readMcpServer(GW_MCP_SERVER);
  if (!cfg)
    throw new Error(`google-workspace MCP server not found in ${MCP_CONFIG_CANDIDATES.join(", ")}`);

  const driveQuery = buildDriveQuery(conf);

  const client = new McpStdioClient(cfg);
  const errors: string[] = [];
  const fail =
    <T>(fallback: T) =>
    (e: unknown): T => {
      errors.push(e instanceof Error ? e.message : String(e));
      return fallback;
    };
  try {
    await client.initialize();

    const [calResult, searchResult, driveResult] = await Promise.all([
      client
        .callJson<CalendarEvent[] | { items?: CalendarEvent[]; events?: CalendarEvent[] }>(
          "calendar_listEvents",
          {
            calendarId: "primary",
            date: dateIso,
            timeMin: `${dateIso}T00:00:00Z`,
            timeMax: `${dateIso}T23:59:59Z`,
            maxResults: conf.calendar.maxResults,
          },
        )
        .catch(fail([] as CalendarEvent[])),
      client
        .callJson<{ messages?: Array<{ id: string }> }>("gmail_search", {
          query: gmailQuery,
          maxResults: conf.gmail.maxResults,
        })
        .catch(fail({ messages: [] as Array<{ id: string }> })),
      driveQuery
        ? client
            .callJson<{ files?: DriveFile[] }>("drive_search", {
              query: driveQuery,
              pageSize: conf.drive.maxResults,
            })
            .catch(fail({ files: [] as DriveFile[] }))
        : Promise.resolve({ files: [] as DriveFile[] }),
    ]);

    const rawEvents: CalendarEvent[] = Array.isArray(calResult)
      ? calResult
      : (calResult.items ?? calResult.events ?? []);
    const events = filterCalendarEvents(rawEvents).filter(
      (ev) => (ev.start?.dateTime || "").startsWith(dateIso) || ev.start?.date === dateIso,
    );

    const ids = (searchResult.messages ?? []).slice(0, conf.gmail.maxDetail).map((m) => m.id);
    const gmail: GmailMsg[] = [];
    for (const id of ids) {
      try {
        const msg = await client.callJson<{
          id: string;
          threadId: string;
          from?: string;
          subject?: string;
        }>("gmail_get", { messageId: id, format: "metadata" });
        gmail.push({
          id: msg.id,
          threadId: msg.threadId,
          from: msg.from ?? "",
          subject: msg.subject ?? "",
        });
      } catch {
        /* skip individual message failures */
      }
    }

    let docs = (driveResult.files ?? []).filter((f) => f.id && f.name);
    if (conf.drive.onlyUnreviewed) docs = docs.filter(needsReview);
    docs = docs.slice(0, conf.drive.maxResults);

    // Every call failed: almost certainly auth. Surface as an integration error.
    const attempted = driveQuery ? 3 : 2;
    if (errors.length >= attempted) {
      throw new Error(
        `${errors.join("; ")} — likely expired Google OAuth; re-auth: node ~/.npm/_npx/*/node_modules/gemini-workspace-extension/workspace-server/dist/headless-login.js --force`,
      );
    }
    return { events, gmail, docs, errors };
  } finally {
    client.close();
  }
}

// ---------------------------------------------------------------------------
// Line builders (own all journal markdown structure)
// ---------------------------------------------------------------------------

function browseUrl(base: string, key: string): string {
  return `${base}/browse/${key}`;
}

/**
 * Map Jira key (epic or initiative) -> `1-projects/<slug>` folder name, read from
 * the `jira_epic`/`jira_initiative` frontmatter of each project README. Built once
 * per process; a missing or empty `1-projects/` dir just yields an empty map, so
 * this degrades silently rather than failing the run.
 */
let projectEpicMapCache: Map<string, string> | null = null;

function loadProjectEpicMap(): Map<string, string> {
  if (projectEpicMapCache) return projectEpicMapCache;
  const map = new Map<string, string>();
  try {
    const projectsDir = join(dirname(resolveJournalPath()), "1-projects");
    for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const readmePath = join(projectsDir, entry.name, "README.md");
      if (!existsSync(readmePath)) continue;
      const frontmatter = readFileSync(readmePath, "utf-8").match(/^---\n([\s\S]*?)\n---/)?.[1];
      if (!frontmatter) continue;
      for (const field of ["jira_epic", "jira_initiative"]) {
        const key = frontmatter.match(new RegExp(`^${field}:\\s*(\\S+)`, "m"))?.[1];
        if (key && key !== "null") map.set(key, entry.name);
      }
    }
  } catch {
    /* no 1-projects dir, or unreadable — map stays empty */
  }
  projectEpicMapCache = map;
  return map;
}

function jiraLine(base: string, issue: MappedIssue, extraBadges: string[] = []): string {
  const badges = [issue.status, ...extraBadges].map((b) => `\`${b}\``).join(" ");
  const projectSlug = loadProjectEpicMap().get(issue.key);
  const projectLink = projectSlug ? ` [project](1-projects/${projectSlug}/)` : "";
  return `- [ ] ${issue.summary} [${issue.key}](${browseUrl(base, issue.key)})${projectLink} ${badges}`.trimEnd();
}

/** Editor URL for the native Google types, generic Drive viewer for anything else. */
function driveUrl(f: DriveFile): string {
  switch (f.mimeType) {
    case "application/vnd.google-apps.document":
      return `https://docs.google.com/document/d/${f.id}/edit`;
    case "application/vnd.google-apps.spreadsheet":
      return `https://docs.google.com/spreadsheets/d/${f.id}/edit`;
    case "application/vnd.google-apps.presentation":
      return `https://docs.google.com/presentation/d/${f.id}/edit`;
    default:
      return `https://drive.google.com/file/d/${f.id}/view`;
  }
}

function docLine(f: DriveFile): string {
  // No badge for a doc you've already read since its last edit — that only shows
  // up when onlyUnreviewed is off, and calling it "updated" would be a lie.
  const badge = !f.viewedByMeTime ? " `new`" : needsReview(f) ? " `updated`" : "";
  return `- [ ] ${f.name} [Doc](${driveUrl(f)})${badge}`;
}

function meetingLine(ev: CalendarEvent): string {
  const start = ev.start?.dateTime?.slice(11, 16) ?? "all-day";
  const end = ev.end?.dateTime?.slice(11, 16) ?? "";
  const time = end ? `${start}\u2013${end}` : start;
  const title = ev.summary ?? "(no title)";
  const link = ev.htmlLink ? `[${title}](${ev.htmlLink})` : title;
  return `- [ ] ${time} ${link}`;
}

/**
 * Extract a human-friendly sender label from a raw `From` header.
 * `"Jane Doe" <jane@example.com>` -> `Jane Doe`; a bare address is returned as-is.
 */
function parseSender(from: string): string {
  const trimmed = (from || "").trim();
  if (!trimmed) return "Unknown sender";
  const m = trimmed.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) {
    const name = m[1].trim();
    return name || m[2].trim();
  }
  return trimmed;
}

/** Normalise a subject for de-dup: strip Re:/Fwd: prefixes, collapse whitespace, lowercase. */
function normalizeSubject(subject: string): string {
  return (subject || "")
    .replace(/^(\s*(re|fwd|fw)\s*:\s*)+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * Build the Gmail portion of the "needs response" list: group messages by sender
 * and de-dupe by normalised subject within each sender (collapses thread replies
 * and forwards into a single line). Senders are ordered by message count desc,
 * then alphabetically, so a sender's mail stays visually grouped in the flat list.
 */
function buildGmailLines(msgs: GmailMsg[]): string[] {
  interface SenderGroup {
    display: string;
    seen: Set<string>;
    msgs: GmailMsg[];
  }
  const bySender = new Map<string, SenderGroup>();
  for (const m of msgs) {
    if (!m.subject) continue;
    const display = parseSender(m.from);
    const key = display.toLowerCase();
    let group = bySender.get(key);
    if (!group) {
      group = { display, seen: new Set(), msgs: [] };
      bySender.set(key, group);
    }
    const subjKey = normalizeSubject(m.subject);
    if (group.seen.has(subjKey)) continue;
    group.seen.add(subjKey);
    group.msgs.push(m);
  }

  const groups = [...bySender.values()].sort(
    (a, b) => b.msgs.length - a.msgs.length || a.display.localeCompare(b.display),
  );
  const lines: string[] = [];
  for (const group of groups) {
    for (const m of group.msgs) {
      lines.push(
        `- [ ] ${group.display} \u2014 ${m.subject} [Gmail](https://mail.google.com/mail/u/0/#inbox/${m.threadId}) \`action\``,
      );
    }
  }
  return lines;
}

/**
 * A message needs a response when it @mentions you, or when it asks a question
 * somewhere `questionScope` covers. Widening the search to whole channels pulls
 * in conversations you aren't part of, so question-matching is scoped separately
 * from mention-matching rather than applying everywhere.
 */
function isActionableSlack(m: SlackMatch, conf: MorningConfig): boolean {
  const t = (m.text || "").toLowerCase();
  if (t.includes(`<@${conf.slack.userId.toLowerCase()}>`)) return true;
  if (!t.includes("?")) return false;
  switch (conf.slack.questionScope) {
    case "any":
      return true;
    case "dms":
      return (m.channel?.id || "").startsWith("D");
    default:
      return false;
  }
}

async function settle<T>(
  label: string,
  p: Promise<T>,
): Promise<{ label: string; value?: T; err?: unknown }> {
  try {
    return { label, value: await p };
  } catch (err) {
    return { label, err };
  }
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Days of lookback for freshness queries: Monday looks back to Friday (3), else 1. */
function lookbackDays(dateIso: string): number {
  const day = new Date(`${dateIso}T12:00:00`).getDay();
  return day === 1 ? 3 : 1;
}

// ---------------------------------------------------------------------------
// Weekly-objectives email helpers (line-manager summary on a new week)
// ---------------------------------------------------------------------------

/** Locate work-journal.md the same way the journal extension does. */
function resolveJournalPath(): string {
  if (process.env.JOURNAL_DIR) {
    const p = join(process.env.JOURNAL_DIR, "work-journal.md");
    if (existsSync(p)) return p;
  }
  const fallback = join(homedir(), "src/github.com/cshirley/documentation/work-journal.md");
  if (existsSync(fallback)) return fallback;
  throw new Error("Cannot locate work-journal.md. Set $JOURNAL_DIR.");
}

/** Monday (ISO week start) for a YYYY-MM-DD date — matches the journal extension. */
function getMonday(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

/** Convert a journal objective line into an HTML <li>, turning [text](url) into a link. */
function objectiveToHtml(line: string): string {
  let text = line.replace(/^- \[[ x~>-]\]\s*/, "");
  const badges: string[] = [];
  text = text.replace(/`([^`]+)`/g, (_m, b) => {
    badges.push(b);
    return "";
  });
  text = text.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_m, label, url) => `<a href="${url}">${label}</a>`,
  );
  text = text.replace(/\s+/g, " ").trim();
  const suffix = badges.length ? ` <em>(${badges.join(", ")})</em>` : "";
  return `<li>${text}${suffix}</li>`;
}

interface WeekEmailState {
  week?: string;
  emailedAt?: string;
  /** "drafted" = Gmail draft created for review, not yet sent. "sent" = delivered. */
  status?: "drafted" | "sent";
}

function readWeekEmailState(): WeekEmailState {
  try {
    return JSON.parse(readFileSync(WEEK_EMAIL_STATE_FILE, "utf-8"));
  } catch {
    return {};
  }
}

function writeWeekEmailState(state: WeekEmailState): void {
  try {
    mkdirSync(PAYLOAD_DIR, { recursive: true });
    writeFileSync(WEEK_EMAIL_STATE_FILE, JSON.stringify(state, null, 2));
  } catch {
    /* best-effort; a failed marker just risks a duplicate email next run */
  }
}

export interface WeekEmailResult {
  status:
    | "sent"
    | "drafted"
    | "skipped-already-sent"
    | "skipped-already-drafted"
    | "skipped-no-objectives"
    | "error";
  week: string;
  to: string;
  count: number;
  detail?: string;
  /** Raw objective lines for the week, so callers can review before sending. */
  objectives?: string[];
  /** Plain-text rendering of what the email would contain (subject + bullets). */
  preview?: string;
}

/**
 * Draft (or send) the current week's objectives to the line manager.
 *
 * Default behaviour is review-first: calling with no `send` flag only ever
 * creates/updates a Gmail draft and returns a `preview` of the content — it
 * never delivers mail on its own. Pass `send: true` once you've checked the
 * objectives (or the `preview` text) to actually deliver it. `force` bypasses
 * the once-per-week idempotency guard entirely (useful for re-drafting after
 * editing the journal, or testing).
 */
export async function emailWeekObjectives(opts: {
  date?: string;
  to?: string;
  draft?: boolean;
  send?: boolean;
  force?: boolean;
}): Promise<WeekEmailResult> {
  const conf = getConfig();
  const today = opts.date || todayIso();
  const monday = getMonday(today);
  const to = opts.to || conf.email.managerEmail;
  // `send: true` (or legacy `draft: false`) delivers for real; anything else
  // only drafts, so objectives can be verified before anyone sees them.
  const wantSend = opts.send === true || opts.draft === false;
  const draft = !wantSend;

  let objectives: string[] = [];
  let recap: ReturnType<typeof computePreviousWeekRecap> = null;
  try {
    const content = readFileSync(resolveJournalPath(), "utf-8");
    objectives = extractWeekObjectives(content, monday);
    recap = computePreviousWeekRecap(content, monday);
  } catch (err) {
    return { status: "error", week: monday, to, count: 0, detail: String(err) };
  }

  const preview = objectives.length
    ? [`Weekly objectives — W/C ${monday}`, "", ...objectives.map((o) => `- ${o}`)].join("\n")
    : undefined;

  if (!opts.force) {
    const state = readWeekEmailState();
    if (state.week === monday) {
      // Legacy markers (pre-status field) only ever recorded a real send.
      const effectiveStatus = state.status ?? "sent";
      if (effectiveStatus === "sent") {
        return {
          status: "skipped-already-sent",
          week: monday,
          to,
          count: objectives.length,
          objectives,
          preview,
        };
      }
      if (effectiveStatus === "drafted" && !wantSend) {
        return {
          status: "skipped-already-drafted",
          week: monday,
          to,
          count: objectives.length,
          objectives,
          preview,
        };
      }
      // effectiveStatus === "drafted" && wantSend: fall through and deliver now.
    }
  }

  if (!objectives.length) {
    // Don't mark the week as done — a later run (once objectives exist) can send.
    return { status: "skipped-no-objectives", week: monday, to, count: 0, objectives: [], preview };
  }

  const cfg = readMcpServer(GW_MCP_SERVER);
  if (!cfg) {
    return {
      status: "error",
      week: monday,
      to,
      count: 0,
      detail: "google-workspace MCP not configured",
    };
  }

  // Salutation follows the effective recipient so an overridden `to` still
  // greets the right person, unless the config pins a name explicitly.
  const managerName = conf.email.managerName ?? nameFromEmail(to);
  const subject = `Weekly objectives — W/C ${monday}`;
  const bodyParts = [`<p>Hi ${managerName},</p>`];

  if (recap && (recap.delivered.length || recap.stillOpen.length)) {
    bodyParts.push(`<p>Last week (W/C ${recap.prevMonday}):</p>`);
    if (recap.delivered.length) {
      bodyParts.push(
        `<p><strong>Delivered:</strong></p>`,
        `<ul>`,
        ...recap.delivered.map(objectiveToHtml),
        `</ul>`,
      );
    }
    if (recap.stillOpen.length) {
      bodyParts.push(
        `<p><strong>Still open:</strong></p>`,
        `<ul>`,
        ...recap.stillOpen.map(objectiveToHtml),
        `</ul>`,
      );
    }
  }

  bodyParts.push(
    `<p>My objectives for the week commencing ${monday}:</p>`,
    `<ul>`,
    ...objectives.map(objectiveToHtml),
    `</ul>`,
    `<p>Thanks,<br/>${conf.email.senderName}</p>`,
  );
  const body = bodyParts.join("\n");

  const client = new McpStdioClient(cfg);
  try {
    await client.initialize();
    const tool = draft ? "gmail_createDraft" : "gmail_send";
    await client.callText(tool, { to, subject, body, isHtml: true });
  } catch (err) {
    return { status: "error", week: monday, to, count: objectives.length, detail: String(err) };
  } finally {
    client.close();
  }

  writeWeekEmailState({
    week: monday,
    emailedAt: new Date().toISOString(),
    status: draft ? "drafted" : "sent",
  });
  return {
    status: draft ? "drafted" : "sent",
    week: monday,
    to,
    count: objectives.length,
    objectives,
    preview,
  };
}

// ---------------------------------------------------------------------------
// Result shape (journalPayload sections written by morning-run)
// ---------------------------------------------------------------------------

interface JournalPayload {
  gdpr?: string[];
  needsResponse?: string[];
  activeWork?: string[];
  meetings?: string[];
  docsToReview?: string[];
  backlog?: string[];
  watched?: string[];
  /** Seeded into the ## W/C block when it has no objective lines yet (matches email-week-objectives fallback). */
  weekObjectives?: string[];
}

type IntegrationStatus = "ok" | "unavailable" | "error";

export interface MorningResult {
  date: string;
  integrations: Record<string, IntegrationStatus>;
  /** Human-readable reason per integration that is not "ok". */
  integrationErrors: Record<string, string>;
  counts: Record<string, number>;
  journalPayload: JournalPayload;
  /** Absolute path the payload was persisted to (debug / manual retry). */
  payloadPath: string;
}

// ---------------------------------------------------------------------------
// Composite orchestration
// ---------------------------------------------------------------------------

export async function assembleBriefing(
  dateOverride?: string,
  maxSlack?: number,
): Promise<MorningResult> {
  const conf = getConfig();
  const date = dateOverride || todayIso();
  const back = lookbackDays(date);
  const slackLimit = maxSlack ?? conf.slack.maxItems;
  const jiraAuth = getJiraAuth();
  const base = jiraAuth?.baseUrl ?? conf.jira.baseUrl;
  const googleCfg = readMcpServer(GW_MCP_SERVER);

  const integrations: Record<string, IntegrationStatus> = {
    jira: jiraAuth ? "ok" : "unavailable",
    google: googleCfg ? "ok" : "unavailable",
    slack: getSlackAuth() ? "ok" : "unavailable",
  };
  const integrationErrors: Record<string, string> = {};
  if (!jiraAuth)
    integrationErrors.jira = `no Jira credentials in ${AUTH_FILE} or JIRA_EMAIL+JIRA_API_KEY`;
  if (!googleCfg)
    integrationErrors.google = `google-workspace MCP server not found in ${MCP_CONFIG_CANDIDATES.join(", ")}`;
  if (integrations.slack !== "ok")
    integrationErrors.slack = `no Slack credentials in ${AUTH_FILE} or SLACK_BOT_TOKEN`;
  const jiraOk = integrations.jira === "ok";
  const slackOk = integrations.slack === "ok";
  const googleOk = integrations.google === "ok";

  const gmailQuery = buildGmailQuery(conf, back);

  const results = await Promise.all([
    settle(
      "active",
      jiraOk
        ? jiraSearch(conf.jira.queries.active.jql, conf.jira.queries.active.maxResults)
        : Promise.resolve<MappedIssue[]>([]),
    ),
    settle(
      "backlog",
      jiraOk
        ? jiraSearch(conf.jira.queries.backlog.jql, conf.jira.queries.backlog.maxResults)
        : Promise.resolve<MappedIssue[]>([]),
    ),
    settle(
      "watched",
      jiraOk
        ? jiraSearch(conf.jira.queries.watched.jql, conf.jira.queries.watched.maxResults)
        : Promise.resolve<MappedIssue[]>([]),
    ),
    settle(
      "slack",
      slackOk
        ? gatherSlack(buildSlackQueries(conf), conf.slack.searchCount)
        : Promise.resolve<SlackMatch[]>([]),
    ),
    settle(
      "google",
      googleOk
        ? gatherGoogle(date, gmailQuery)
        : Promise.resolve<GoogleData>({ events: [], gmail: [], docs: [] }),
    ),
  ]);

  const byLabel = new Map(results.map((r) => [r.label, r]));
  const pick = <T>(label: string, fallback: T): T => {
    const r = byLabel.get(label);
    if (!r) return fallback;
    if (r.err) {
      const svc = label === "google" ? "google" : label === "slack" ? "slack" : "jira";
      integrations[svc] = "error";
      const msg = r.err instanceof Error ? r.err.message : String(r.err);
      integrationErrors[svc] = integrationErrors[svc]
        ? `${integrationErrors[svc]}; ${label}: ${msg}`
        : `${label}: ${msg}`;
      return fallback;
    }
    return (r.value as T) ?? fallback;
  };

  const active = pick<MappedIssue[]>("active", []);
  const backlogRaw = pick<MappedIssue[]>("backlog", []);
  const watchedRaw = pick<MappedIssue[]>("watched", []);
  const slack = pick<SlackMatch[]>("slack", []);
  const google = pick<GoogleData>("google", { events: [], gmail: [], docs: [] });
  if (google.errors?.length) {
    integrations.google = "error";
    integrationErrors.google = `partial: ${google.errors.join("; ")}`;
  }
  const events = google.events;
  const gmailMsgs = google.gmail;
  const docs = google.docs;

  // Dedup Jira by key across the three queries.
  const activeKeys = new Set(active.map((i) => i.key));
  const backlog = backlogRaw.filter((i) => !activeKeys.has(i.key));
  const backlogKeys = new Set(backlog.map((i) => i.key));
  const watched = watchedRaw.filter((i) => !activeKeys.has(i.key) && !backlogKeys.has(i.key));

  // Build the journal payload (all in code).
  const payload: JournalPayload = {};

  const activeLines = active.map((i) => jiraLine(base, i));
  if (activeLines.length) payload.activeWork = activeLines;

  const meetingLines = events.map(meetingLine);
  if (meetingLines.length) payload.meetings = meetingLines;

  const docLines = docs.map(docLine);
  if (docLines.length) payload.docsToReview = docLines;

  const backlogLines = backlog.map((i) => jiraLine(base, i));
  if (backlogLines.length) payload.backlog = backlogLines;

  const watchedLines = watched.map((i) => jiraLine(base, i, ["watched"]));
  if (watchedLines.length) payload.watched = watchedLines;

  const needs: string[] = buildGmailLines(gmailMsgs);
  const excludedChannels = new Set(conf.slack.excludeChannels.map(normalizeChannel));
  let slackCount = 0;
  for (const m of slack) {
    if (slackCount >= slackLimit) break;
    if (excludedChannels.has(normalizeChannel(m.channel?.name ?? ""))) continue;
    if (!isActionableSlack(m, conf)) continue;
    const snippet = m.text.replace(/\s+/g, " ").slice(0, 120);
    needs.push(`- [ ] ${snippet} [Slack](${m.permalink}) \`action\``);
    slackCount++;
  }
  if (needs.length) payload.needsResponse = needs;

  // Seed the ## W/C OBJECTIVES block when empty: carry over unfinished items from
  // the previous week, then add today's Active work (deduped by Jira key).
  try {
    const monday = getMonday(date);
    const journalContent = readFileSync(resolveJournalPath(), "utf-8");
    if (!extractWeekObjectives(journalContent, monday).length) {
      const objectives = buildWeekObjectives(journalContent, monday, activeLines);
      if (objectives.length) payload.weekObjectives = objectives;
    }
  } catch {
    /* journal unreadable — skip objectives seeding */
  }

  const counts: Record<string, number> = {};
  if (payload.needsResponse) counts["Needs response / action"] = payload.needsResponse.length;
  if (payload.activeWork) counts["Active work"] = payload.activeWork.length;
  if (payload.meetings) counts["Meetings today"] = payload.meetings.length;
  if (payload.docsToReview) counts["Docs to review"] = payload.docsToReview.length;
  if (payload.backlog) counts["Backlog / FYI"] = payload.backlog.length;
  if (payload.watched) counts.Watched = payload.watched.length;
  if (payload.weekObjectives) counts["Week objectives"] = payload.weekObjectives.length;

  // Persist the payload for debugging or manual retry.
  let payloadPath = "";
  try {
    mkdirSync(PAYLOAD_DIR, { recursive: true });
    writeFileSync(PAYLOAD_FILE, JSON.stringify(payload, null, 2));
    payloadPath = PAYLOAD_FILE;
  } catch {
    payloadPath = "";
  }

  return { date, integrations, integrationErrors, counts, journalPayload: payload, payloadPath };
}

export async function runMorningPipeline(dateOverride?: string, maxSlack?: number) {
  const briefing = await assembleBriefing(dateOverride, maxSlack);
  const { weekObjectives, ...sections } = briefing.journalPayload;

  let lastWeekRecap: string[] | undefined;
  try {
    const journalContent = readFileSync(resolveJournalPath(), "utf-8");
    const recap = computePreviousWeekRecap(journalContent, getMonday(briefing.date));
    if (recap) lastWeekRecap = formatLastWeekRecapBlock(recap);
  } catch {
    /* journal unreadable — skip recap */
  }

  let journalWrite: Awaited<ReturnType<typeof writeJournalEntry>> | null = null;
  if (Object.keys(sections).length > 0 || weekObjectives?.length || lastWeekRecap?.length) {
    journalWrite = await writeJournalEntry({
      date: briefing.date,
      sections,
      weekObjectives,
      lastWeekRecap,
    });
  }

  const weekEmail = await emailWeekObjectives({ date: briefing.date });
  return { briefing, journalWrite, weekEmail };
}

/** WARNING lines for every integration that did not return data. */
export function integrationWarnings(
  r: Pick<MorningResult, "integrations" | "integrationErrors">,
): string[] {
  return Object.entries(r.integrations)
    .filter(([, v]) => v !== "ok")
    .map(
      ([k, v]) =>
        `WARNING: ${k} ${v} — ${r.integrationErrors[k] ?? "no detail"} (its sections are missing from the journal)`,
    );
}

export function formatMorningRunSummary(
  result: Awaited<ReturnType<typeof runMorningPipeline>>,
): string {
  const { briefing, journalWrite, weekEmail } = result;
  const intg = Object.entries(briefing.integrations)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  const lines: string[] = [];
  lines.push(`Morning run complete for ${briefing.date} (${intg})`);
  lines.push(...integrationWarnings(briefing));
  const { loadError } = getConfig();
  if (loadError) lines.push(`WARNING: config file ignored, using defaults — ${loadError}`);
  lines.push("");
  if (Object.keys(briefing.counts).length === 0) {
    lines.push("No items gathered.");
  } else {
    for (const [section, n] of Object.entries(briefing.counts)) {
      lines.push(`- ${section}: ${n}`);
    }
  }
  lines.push("");
  if (journalWrite) {
    lines.push(
      journalWrite.content[0]?.type === "text" ? journalWrite.content[0].text : "Journal updated.",
    );
  } else {
    lines.push("Journal: nothing to write.");
  }
  lines.push("");
  const emailMsg: Record<WeekEmailResult["status"], string> = {
    sent: `Objectives emailed (${weekEmail.count}) to ${weekEmail.to} for W/C ${weekEmail.week}.`,
    drafted: `Objectives drafted (${weekEmail.count}) to ${weekEmail.to} for W/C ${weekEmail.week} — review, then run email-week-objectives with send: true to deliver.`,
    "skipped-already-sent": `Objectives already emailed for W/C ${weekEmail.week}.`,
    "skipped-already-drafted": `Objectives already drafted for W/C ${weekEmail.week} — review the Gmail draft, then run email-week-objectives with send: true to deliver.`,
    "skipped-no-objectives": `No objectives for W/C ${weekEmail.week} yet.`,
    error: `Objectives email failed for W/C ${weekEmail.week}: ${weekEmail.detail ?? "unknown error"}.`,
  };
  lines.push(emailMsg[weekEmail.status]);
  if (weekEmail.preview && weekEmail.status !== "skipped-already-sent") {
    lines.push("");
    lines.push("--- preview ---");
    lines.push(weekEmail.preview);
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Extension registration
// ---------------------------------------------------------------------------

/** Text summary for a gather-only briefing (shared by pi tool and CLI). */
export function formatBriefingSummary(result: MorningResult): string {
  const intg = Object.entries(result.integrations)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  const lines: string[] = [];
  lines.push(`Morning briefing assembled for ${result.date} (${intg})`);
  lines.push(...integrationWarnings(result));
  lines.push("");
  if (Object.keys(result.counts).length === 0) {
    lines.push("No items gathered.");
  } else {
    for (const [section, n] of Object.entries(result.counts)) {
      lines.push(`- ${section}: ${n}`);
    }
  }
  lines.push("");
  if (result.payloadPath && Object.keys(result.journalPayload).length > 0) {
    lines.push(`Payload written to: ${result.payloadPath}`);
    lines.push("Prefer `morning-run` for the full workflow (gather + journal + email).");
  } else {
    lines.push("Nothing to write — journalPayload is empty.");
  }
  return lines.join("\n");
}

/** Text summary for the weekly-objectives email result (shared by pi tool and CLI). */
export function formatEmailResult(r: WeekEmailResult): string {
  const msg: Record<WeekEmailResult["status"], string> = {
    sent: `Sent weekly objectives (${r.count}) to ${r.to} for W/C ${r.week}.`,
    drafted: `Drafted weekly objectives (${r.count}) to ${r.to} for W/C ${r.week} — review below, then call again with send: true to deliver.`,
    "skipped-already-sent": `Objectives already emailed for W/C ${r.week}. No email sent.`,
    "skipped-already-drafted": `Objectives already drafted for W/C ${r.week}. Review below, then call again with send: true to deliver (or force: true to re-draft).`,
    "skipped-no-objectives": `No objectives found for W/C ${r.week} yet. No email sent.`,
    error: `Could not email objectives for W/C ${r.week}: ${r.detail ?? "unknown error"}.`,
  };
  let text = msg[r.status];
  if (r.preview && r.status !== "skipped-already-sent") {
    text += `\n\n--- preview ---\n${r.preview}`;
  }
  return text;
}
