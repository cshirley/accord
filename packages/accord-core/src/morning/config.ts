/**
 * Configuration for the morning briefing.
 *
 * Values resolve with precedence: environment variable > config file > built-in
 * default. The file is optional — with no file and no env vars the defaults here
 * reproduce the extension's original hardcoded behaviour exactly.
 *
 * The file lives at $MORNING_CONFIG_PATH, else ~/.pi/agent/morning-briefing.json,
 * matching the <extension>.json convention used by the other extensions. The
 * run-to-run payload dump is morning-briefing.tmp.json.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface JiraQuery {
  jql: string;
  maxResults: number;
}

export interface MorningConfig {
  jira: {
    /** Fallback base URL; a baseUrl in service-auth.json still wins over this. */
    baseUrl: string;
    queries: {
      active: JiraQuery;
      backlog: JiraQuery;
      watched: JiraQuery;
    };
  };
  slack: {
    userId: string;
    /** How many mentions to fetch before filtering. */
    searchCount: number;
    /** How many actionable mentions to surface in the journal. */
    maxItems: number;
    /** Channels to search in addition to your mentions. Empty means mentions only. */
    channels: string[];
    /** Channels to drop from results, applied even to direct mentions. */
    excludeChannels: string[];
    /**
     * Which messages count as actionable on the strength of a "?" alone.
     * A message that mentions you is always actionable regardless of this.
     *   any  — any question (the original behaviour; noisy once channels are added)
     *   dms  — only questions in DMs
     *   none — mentions only
     */
    questionScope: "any" | "dms" | "none";
  };
  gmail: {
    baseQuery: string;
    excludeCategories: string[];
    excludeSenders: string[];
    /** Appended verbatim to the end of the assembled query. */
    extraQuery: string;
    maxResults: number;
    /** Cap on per-message detail lookups, which cost one round-trip each. */
    maxDetail: number;
  };
  calendar: {
    /** Titles dropped when the event has no attendees (working-location noise). */
    skipSummaries: string[];
    maxResults: number;
  };
  drive: {
    /** Drive folder IDs to scan. Note that Drive's `in parents` does not recurse. */
    folderIds: string[];
    /** Include everything shared with you, wherever it lives. */
    sharedWithMe: boolean;
    /** Only consider files modified within this many days. */
    maxAgeDays: number;
    maxResults: number;
    /** Keep only files you have never opened, or that changed since you last did. */
    onlyUnreviewed: boolean;
    /** Name substrings to exclude, e.g. "Notes by Gemini". Matched case-insensitively by Drive. */
    excludeNames: string[];
    /** Raw Drive query clauses to exclude; each is negated and ANDed on. */
    excludeQueries: string[];
    /** Extra Drive query clause, ANDed onto the generated query as-is. */
    extraQuery: string;
  };
  email: {
    managerEmail: string;
    /** Salutation name. Derived from the recipient address when unset. */
    managerName?: string;
    senderName: string;
  };
  /** Absolute path the config was read from, or null when no file exists. */
  sourcePath: string | null;
  /** Set when a file exists but could not be read or parsed; defaults were used. */
  loadError?: string;
}

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer U>
    ? U[]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

export type MorningConfigFile = DeepPartial<Omit<MorningConfig, "sourcePath" | "loadError">>;

function defaults(): Omit<MorningConfig, "sourcePath" | "loadError"> {
  return {
    jira: {
      baseUrl: "https://babylonpartners.atlassian.net",
      queries: {
        active: {
          jql: 'assignee = currentUser() AND resolution = Unresolved AND status in ("In Progress", "In Review", "To Do") AND updated >= -14d ORDER BY updated DESC',
          maxResults: 15,
        },
        backlog: {
          jql: 'assignee = currentUser() AND resolution = Unresolved AND status in ("To Do", "Backlog") ORDER BY priority DESC',
          maxResults: 20,
        },
        watched: {
          jql: "watcher = currentUser() AND assignee != currentUser() AND updated >= -14d AND resolution = Unresolved ORDER BY updated DESC",
          maxResults: 10,
        },
      },
    },
    slack: {
      userId: "U06JZHDQW4S",
      searchCount: 15,
      maxItems: 5,
      channels: [],
      excludeChannels: [],
      questionScope: "any",
    },
    gmail: {
      baseQuery: "is:unread",
      excludeCategories: ["promotions", "social"],
      excludeSenders: [
        "weekly@updates.miro.com",
        "notifications@app.bamboohr.com",
        "github-actions[bot]",
      ],
      extraQuery: "",
      maxResults: 25,
      maxDetail: 10,
    },
    calendar: {
      skipSummaries: ["home", "office", "wfh", "remote"],
      maxResults: 50,
    },
    drive: {
      folderIds: [],
      sharedWithMe: false,
      maxAgeDays: 7,
      maxResults: 10,
      onlyUnreviewed: true,
      // Google generates one of each per meeting; with a normal meeting load these
      // would swamp the section within a day.
      excludeNames: ["Notes by Gemini", "- Recording"],
      excludeQueries: [],
      extraQuery: "",
    },
    email: {
      managerEmail: "olly.mayes@emed.com",
      senderName: "Clive",
    },
  };
}

export function configPath(): string {
  return (
    process.env.MORNING_CONFIG_PATH ?? join(homedir(), ".pi", "agent", "morning-briefing.json")
  );
}

/** Read an env var, treating blank as unset so an empty override can't erase a default. */
function env(name: string): string | undefined {
  const v = process.env[name];
  return v?.trim() ? v : undefined;
}

function mergeQuery(base: JiraQuery, override?: DeepPartial<JiraQuery>): JiraQuery {
  return {
    jql: override?.jql ?? base.jql,
    maxResults: override?.maxResults ?? base.maxResults,
  };
}

function merge(file: MorningConfigFile): Omit<MorningConfig, "sourcePath" | "loadError"> {
  const d = defaults();
  return {
    jira: {
      baseUrl: env("ATLASSIAN_BASE_URL") ?? file.jira?.baseUrl ?? d.jira.baseUrl,
      queries: {
        active: mergeQuery(d.jira.queries.active, file.jira?.queries?.active),
        backlog: mergeQuery(d.jira.queries.backlog, file.jira?.queries?.backlog),
        watched: mergeQuery(d.jira.queries.watched, file.jira?.queries?.watched),
      },
    },
    slack: {
      userId: env("MORNING_SLACK_USER_ID") ?? file.slack?.userId ?? d.slack.userId,
      searchCount: file.slack?.searchCount ?? d.slack.searchCount,
      maxItems: file.slack?.maxItems ?? d.slack.maxItems,
      channels: file.slack?.channels ?? d.slack.channels,
      excludeChannels: file.slack?.excludeChannels ?? d.slack.excludeChannels,
      questionScope: file.slack?.questionScope ?? d.slack.questionScope,
    },
    gmail: {
      baseQuery: file.gmail?.baseQuery ?? d.gmail.baseQuery,
      excludeCategories: file.gmail?.excludeCategories ?? d.gmail.excludeCategories,
      excludeSenders: file.gmail?.excludeSenders ?? d.gmail.excludeSenders,
      extraQuery: file.gmail?.extraQuery ?? d.gmail.extraQuery,
      maxResults: file.gmail?.maxResults ?? d.gmail.maxResults,
      maxDetail: file.gmail?.maxDetail ?? d.gmail.maxDetail,
    },
    calendar: {
      skipSummaries: (file.calendar?.skipSummaries ?? d.calendar.skipSummaries).map((s) =>
        s.toLowerCase(),
      ),
      maxResults: file.calendar?.maxResults ?? d.calendar.maxResults,
    },
    drive: {
      folderIds: file.drive?.folderIds ?? d.drive.folderIds,
      sharedWithMe: file.drive?.sharedWithMe ?? d.drive.sharedWithMe,
      maxAgeDays: file.drive?.maxAgeDays ?? d.drive.maxAgeDays,
      maxResults: file.drive?.maxResults ?? d.drive.maxResults,
      onlyUnreviewed: file.drive?.onlyUnreviewed ?? d.drive.onlyUnreviewed,
      excludeNames: file.drive?.excludeNames ?? d.drive.excludeNames,
      excludeQueries: file.drive?.excludeQueries ?? d.drive.excludeQueries,
      extraQuery: file.drive?.extraQuery ?? d.drive.extraQuery,
    },
    email: {
      managerEmail:
        env("MORNING_MANAGER_EMAIL") ?? file.email?.managerEmail ?? d.email.managerEmail,
      managerName: env("MORNING_MANAGER_NAME") ?? file.email?.managerName,
      senderName: env("MORNING_SENDER_NAME") ?? file.email?.senderName ?? d.email.senderName,
    },
  };
}

let cached: MorningConfig | null = null;

/**
 * Load the effective config, memoised for the life of the process.
 *
 * A missing file is normal and silent. A malformed file is not: defaults are used
 * so the morning run still completes, and `loadError` is set so callers can
 * surface it — a scheduled run that quietly ignored your settings is worse than
 * one that completes with a warning.
 */
export function getConfig(): MorningConfig {
  if (cached) return cached;

  const path = configPath();
  if (!existsSync(path)) {
    cached = { ...merge({}), sourcePath: null };
    return cached;
  }

  try {
    const file = JSON.parse(readFileSync(path, "utf-8")) as MorningConfigFile;
    cached = { ...merge(file), sourcePath: path };
  } catch (err) {
    cached = {
      ...merge({}),
      sourcePath: path,
      loadError: `${path}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  return cached;
}

/** Drop the memoised config. Exposed for tests. */
export function resetConfig(): void {
  cached = null;
}

/**
 * Quote a `from:` value unless it is a bare address. Display names such as
 * `github-actions[bot]` carry characters Gmail treats as query syntax.
 */
function quoteSender(sender: string): string {
  return /^[\w.+-]+@[\w.-]+$/.test(sender) ? sender : `"${sender.replace(/"/g, "")}"`;
}

/** Assemble the Gmail search query for a given lookback window. */
export function buildGmailQuery(cfg: MorningConfig, lookbackDays: number): string {
  const parts = [cfg.gmail.baseQuery, `newer_than:${lookbackDays}d`];
  for (const c of cfg.gmail.excludeCategories) parts.push(`-category:${c}`);
  for (const s of cfg.gmail.excludeSenders) parts.push(`-from:${quoteSender(s)}`);
  if (cfg.gmail.extraQuery) parts.push(cfg.gmail.extraQuery);
  return parts.filter(Boolean).join(" ");
}

/** Canonical channel form for comparison and query building: no leading #, lowercase. */
export function normalizeChannel(name: string): string {
  return name.trim().replace(/^#/, "").toLowerCase();
}

/**
 * Assemble the Slack searches to run. Callers merge the results and de-duplicate
 * by permalink.
 *
 * Several queries are needed because Slack's search grammar is narrower than it
 * looks, as measured against the live API:
 *   - Parentheses return zero results, so grouping is impossible.
 *   - `to:` cannot be OR-ed with `in:` or with a bare mention; the whole query
 *     silently returns nothing.
 *   - `in:#a OR in:#b` does work.
 * Crucially, `to:<@me>` matches only DMs and group DMs — it never matches an
 * @mention in a channel. Searching the raw `<@me>` token is what surfaces those.
 */
export function buildSlackQueries(cfg: MorningConfig): string[] {
  const queries = [`to:<@${cfg.slack.userId}>`, `<@${cfg.slack.userId}>`];
  const channels = cfg.slack.channels.map(normalizeChannel).filter(Boolean);
  if (channels.length) queries.push(channels.map((c) => `in:#${c}`).join(" OR "));
  return queries;
}

/**
 * Escape a value for a Drive query string literal. Names really do contain
 * apostrophes ("FHIR mapping for 'New World' P3"), so these must be escaped
 * rather than rejected.
 */
function driveLiteral(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

/**
 * Assemble the Drive search query, or null when there is no source to search —
 * neither folders nor sharedWithMe — which is how the "Docs to review" section
 * stays switched off by default.
 *
 * Folder IDs containing a quote are dropped rather than escaped: a real Drive ID
 * never contains one, so such a value is a mistake and must not reach the query.
 *
 * Note that Drive fails an invalid query by returning zero results rather than an
 * error, so a malformed `excludeQueries` or `extraQuery` clause looks exactly like
 * "nothing matched".
 */
export function buildDriveQuery(cfg: MorningConfig, now: Date = new Date()): string | null {
  const folders = cfg.drive.folderIds.map((f) => f.trim()).filter((f) => f && !f.includes("'"));
  if (!folders.length && !cfg.drive.sharedWithMe) return null;

  const since = new Date(now.getTime() - cfg.drive.maxAgeDays * 86400000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");

  // Sources are OR-ed, filters are AND-ed. Folders and sharedWithMe are both
  // sources: asking for one folder plus "shared with me" means the union, not
  // files that are simultaneously in that folder and shared with you.
  const sources = folders.map((id) => `'${id}' in parents`);
  if (cfg.drive.sharedWithMe) sources.push("sharedWithMe = true");

  const parts: string[] = [sources.length === 1 ? sources[0] : `(${sources.join(" or ")})`];
  parts.push(`modifiedTime > '${since}'`);
  parts.push("trashed = false");
  // Subfolders match "in parents" too, and a folder is not a doc to review.
  parts.push("mimeType != 'application/vnd.google-apps.folder'");

  for (const name of cfg.drive.excludeNames) {
    const trimmed = name.trim();
    if (trimmed) parts.push(`not name contains '${driveLiteral(trimmed)}'`);
  }
  for (const clause of cfg.drive.excludeQueries) {
    const trimmed = clause.trim();
    if (trimmed) parts.push(`not (${trimmed})`);
  }
  if (cfg.drive.extraQuery) parts.push(cfg.drive.extraQuery);

  return parts.join(" and ");
}
