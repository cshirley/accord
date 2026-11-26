# Morning Briefing

Harness-neutral morning workflow: gather Jira/Slack/Calendar/Gmail, write `work-journal.md`, and draft the weekly objectives email.

## Entry points

Driven by the `accord-morning` CLI (`packages/accord-cli/src/morning-main.ts`), usually through the `morning` skill. There is no pi extension.

| Command | Purpose |
|---------|---------|
| `accord-morning run` | **Primary.** Gather, write journal, draft objectives email |
| `accord-morning briefing` | Gather only (debug) |
| `accord-morning email` | Objectives email only; `--send` to deliver |

## Modules

| File | Role |
|------|------|
| `pipeline.ts` | Data gathering, journal write, email |
| `paths.ts` | Config and state locations (XDG) |
| `config.ts` | Config schema, defaults, and file/env merging |
| `write-entry.ts` | Journal write/merge logic |
| `weekly-carry-over.ts` | Week objectives seeding from prior week |
| `common.ts` | Journal path resolution and line normalisation |

## Configuration

Optional JSON file at `~/.config/accord/morning-briefing.json` (override the location
with `$MORNING_CONFIG_PATH`; the legacy `~/.pi/agent/morning-briefing.json` is read when the new file is absent). Every key is optional — anything you omit falls
back to the default in `config.ts`, so a partial file only changes what it
mentions. With no file at all the behaviour is identical to the defaults.

Do not confuse this with `~/.local/state/accord/morning-briefing.tmp.json` (`$MORNING_STATE_DIR`), the debug
payload dump the briefing overwrites on every run. The weekly email guard lives in the same state dir. That one is gitignored and
safe to delete.

```json
{
  "jira": {
    "baseUrl": "https://babylonpartners.atlassian.net",
    "queries": {
      "active":  { "jql": "assignee = currentUser() AND ...", "maxResults": 15 },
      "backlog": { "jql": "assignee = currentUser() AND ...", "maxResults": 20 },
      "watched": { "jql": "watcher = currentUser() AND ...",  "maxResults": 10 }
    }
  },
  "slack": {
    "userId": "U06JZHDQW4S",
    "searchCount": 15,
    "maxItems": 5,
    "channels": ["#eng-platform", "#cvs-integration"],
    "excludeChannels": ["#random"],
    "questionScope": "any"
  },
  "gmail": {
    "baseQuery": "is:unread",
    "excludeCategories": ["promotions", "social"],
    "excludeSenders": ["weekly@updates.miro.com", "github-actions[bot]"],
    "extraQuery": "",
    "maxResults": 25,
    "maxDetail": 10
  },
  "calendar": { "skipSummaries": ["home", "office", "wfh", "remote"], "maxResults": 50 },
  "drive": {
    "sharedWithMe": true,
    "folderIds": [],
    "maxAgeDays": 7,
    "maxResults": 10,
    "onlyUnreviewed": true,
    "excludeNames": ["Notes by Gemini", "- Recording"],
    "excludeQueries": [],
    "extraQuery": ""
  },
  "email": { "managerEmail": "olly.mayes@emed.com", "managerName": "Olly", "senderName": "Clive" }
}
```

Notes on individual keys:

- `gmail` assembles to `<baseQuery> newer_than:<N>d -category:... -from:... <extraQuery>`,
  where `N` is 3 on Mondays and 1 otherwise. `maxDetail` caps per-message lookups,
  which cost one round-trip each.
- `gmail.excludeSenders` accepts an address or a display name. Anything that is not
  a bare address is quoted before it reaches Gmail, so `github-actions[bot]` mutes
  the bot without muting the rest of `notifications@github.com`.
- `calendar.skipSummaries` only drops an event when it also has no attendees, so a
  real meeting called "Office" survives.
- `email.managerName` is the salutation. Left unset, it is derived from the
  recipient address (`olly.mayes@emed.com` → "Olly").
- `slack.searchCount` is how many mentions are fetched; `maxItems` is how many
  actionable ones reach the journal. The `maxSlack` tool parameter overrides `maxItems`.

### Slack channels

The briefing runs several Slack searches and merges the results, de-duplicating by
permalink. Slack's search grammar is narrower than it looks, as measured against
the live API:

- Parentheses return **zero** results, so query grouping is impossible.
- `to:` cannot be OR-ed with `in:` or with a bare mention — the whole query
  silently returns nothing.
- `in:#a OR in:#b` does work.
- **`to:<@you>` matches only DMs and group DMs.** It never matches an @mention in
  a channel, which is why the raw `<@you>` token is searched separately.

So the base searches are always `to:<@userId>` (DMs) and `<@userId>` (mentions
anywhere). Adding `channels` appends one more search, `in:#a OR in:#b`, which
picks up channel traffic you were *not* tagged in. The leading `#` is optional and
matching is case-insensitive. `excludeChannels` drops results by channel name and
applies even to direct mentions, so it can mute a channel you're tagged in
constantly.

Because mentions are already found everywhere, you only need `channels` for
channels you want to follow *without* being mentioned.

`questionScope` controls when a bare "?" is enough to make something actionable. A
message that @mentions you is always actionable regardless of this setting.

| `questionScope` | A "?" alone makes it actionable |
|---|---|
| `any` (default) | anywhere |
| `dms` | only in DMs |
| `none` | never; mentions only |

**Keep this at `any` if you configure `channels`.** The two settings interact in a
way that is easy to get backwards: the mention search already finds every message
that tags you, in every channel, whether or not it is listed in `channels`. So the
only thing a channel search contributes is messages that *don't* tag you — and
`dms` or `none` discard exactly those. Setting either alongside `channels` makes
the channel list a no-op; measured against the live API it added zero items.

The noise cost of `any` is bounded by how busy the listed channels are, not by the
whole workspace, so keep the list short and low-volume rather than reaching for a
narrower scope.

### Docs to review

The section has two possible **sources**, and is switched off entirely (no Drive
call at all) when neither is set:

- `sharedWithMe: true` — everything shared with you, wherever it lives. Usually
  what you want, since documents sent to you for review are rarely in one folder.
- `folderIds` — specific folders, using the last path segment of a Drive folder
  URL. Note that Drive's `in parents` does **not** recurse into subfolders.

Sources are OR-ed and filters are AND-ed, so setting both gives you the union:
files in those folders *plus* files shared with you, not the intersection.

The **filters** then apply: files modified within `maxAgeDays`, excluding trashed
items and folders. `onlyUnreviewed` keeps just the files you have never opened or
that changed since you last opened them; turn it off to list everything in the
window. Lines are badged `new` when you have never opened the file and `updated`
when it changed since you last did.

**Exclusions** come in two forms, both lists:

- `excludeNames` — name substrings, each becoming `not name contains '...'`.
  Apostrophes are escaped, so a name like `'New World'` works as an entry.
- `excludeQueries` — raw Drive clauses, each wrapped as `not (...)`. Use this for
  anything not name-based, e.g. `"mimeType = 'application/vnd.google-apps.spreadsheet'"`.

The defaults drop `Notes by Gemini` and `- Recording`, because Google generates one
of each per meeting and they would otherwise swamp the section within a day. Be
aware that Drive's `contains` is token-based rather than a literal substring match,
so an entry can match a little more broadly than it looks.

`extraQuery` is still available for a raw clause ANDed on without negation, such as
`"starred = true"`.

One trap worth knowing: **Drive answers an invalid query with zero results rather
than an error.** If the section goes unexpectedly empty after you edit
`excludeQueries` or `extraQuery`, suspect a syntax error rather than an empty inbox.

Two related things that do *not* work, both checked against the live API: the
`sharedWithMe` boolean parameter on the underlying `drive_search` tool is ignored
(it has to be a query term, which is what this code does), and `sharedWithMeTime`
returns nothing at any window, so you cannot filter by *when* something was shared
with you — only by `modifiedTime`.

Precedence is **env var > config file > default**. The env overrides are
`ATLASSIAN_BASE_URL`, `MORNING_SLACK_USER_ID`, `MORNING_MANAGER_EMAIL`,
`MORNING_MANAGER_NAME`, and `MORNING_SENDER_NAME`.

A missing config file is silent. A malformed one is not: defaults are used so the
scheduled run still completes, and `/morning` prints a warning naming the file.

Not configurable: the Gmail lookback window (3 days on Mondays, 1 otherwise) and
the Jira key prefixes used for journal parsing, which live in `common.ts`.

### Project links

Each Jira line (`active`/`backlog`/`watched`) gets an extra `[project](1-projects/<slug>/)`
link when the issue's key matches a `jira_epic` or `jira_initiative` in the
frontmatter of some `1-projects/*/README.md` in the vault, read relative to
`work-journal.md`'s directory. No match → no link, same line as before. This is
read-only: it never creates, renames, or touches a project folder, so the
AGENTS.md rule against inventing folders for Epic-less work is unaffected. A
missing or empty `1-projects/` directory degrades to no links rather than an
error.

## Scheduled run

`bin/pi-morning` (cron/launchd):

```bash
pi --no-session --no-tools --no-skills -p "/morning"
```

No model or ollama required.

## Lean coding sessions

`bin/pi-lean` (and plain `pi`) exclude morning tools via `--exclude-tools`.
