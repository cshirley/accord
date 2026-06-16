---
name: crq-notify
description: Fetch a Jira CRQ (change request) release ticket, resolve every linked change to its PR (number, labels, author) and Slack handle, and post a formatted release summary to a Slack channel or DM. Use when the user wants to announce, notify, or share a release/change request on Slack.
---

# CRQ Notify

Posts a release summary for a CRQ: a header line plus one line per linked change.
The deterministic work lives in tools — **do not** re-implement Jira link extraction,
status logic, channel resolution, or message sending in the prompt. The skill
orchestrates: it stitches the Jira changes to their GitHub PRs and Slack handles,
applies the emoji rules, and sends.

Tools used:
- `atlassian-getCrqLinkedIssues` — CRQ → header (`status`, `owner`, `rollbackPlan`, `summary`, `jiraUrl`) + linked changes (key, summary, status, `statusDone`, assignee + email) + derived `service`/`repo` (`emed-labs/<service>`)
- GitHub PR tools (e.g. `github_search_issues`, `github_get_pull_request`) — per ticket: PR number, title, labels, author
- `slack-lookupUser` — resolve a PR author to a Slack display name/handle
- `slack-sendMessage` — post to a channel/user/email; supports `threadTs` for replies
- `atlassian-getJiraIssueFields` — (optional) pull change-window/risk fields if a metadata block is also wanted

## Inputs

- **CRQ key** (required) — e.g. `CRQ-5326`
- **target** (required) — `#channel`, channel ID, `@display-name`, or email
- **thread ts** (optional) — reply in an existing thread

If either required input is missing, ask once, then proceed.

## Step 1 — Get the linked changes (code does this)

Call `atlassian-getCrqLinkedIssues` with the CRQ key. You get back the CRQ header
(`key`, `summary`, `status`, `owner`, `rollbackPlan`, `service`, `repo`, `jiraUrl`)
and `issues[]` where each issue has `key`, `summary`, `status`, `statusDone`,
`issueType`, `assignee`, `assigneeEmail`.

- If `issues` is empty, the CRQ has no linked changes — post only the header line
  (Step 4) and tell the user there were no linked tickets.
- `repo` is the GitHub repo to search for PRs (`emed-labs/<service>`).

## Step 2 — Resolve each change's PR (GitHub)

For every issue in `issues`, find its PR **in the CRQ's `repo`** by searching for the
ticket key in the PR title, e.g.:

```
github_search_issues  q: "repo:<repo> <KEY> in:title type:pr"
```

From the matching PR (if several, take the most recently merged) capture:
- `number` and `html_url` → `(#<number>)` link
- `title` → the change description (strip a leading `[<KEY>] ` so it isn't doubled)
- `labels[].name` → check for `release: no-verification-needed`

If no PR is found in the repo, keep the change but omit `(#PR)` and resolve the
emoji from `statusDone` alone.

## Step 3 — Resolve the author's Slack handle

Resolve from the change's **Jira assignee** (from Step 1) via `slack-lookupUser`:

1. Try the assignee **display name** (e.g. `Victor Mora`) — reliable on any token.
2. If that misses, try the assignee **email** (`assigneeEmail`) — only works when the
   Slack token has `users:read.email`.

Use the returned handle as `@<handle>` (plain text, not a real `<@id>` @mention —
don't ping the whole list on a release notice). If nothing matches, fall back to the
assignee display name as-is. (Don't use the GitHub PR author login — the GitHub
search API exposes neither name nor email, so it can't be mapped to Slack reliably.)

## Step 4 — Build the message (exact format)

Start with the CRQ header block (omit `*Rollback plan*` if `rollbackPlan` is empty):

```
*:rotating_light: Change Request — <KEY>*  (<status>)
*Summary:* <summary>
*Owner:* <owner>

*Rollback plan*
<rollbackPlan>
```

Then a blank line and the change list, beginning with:

```
Preparing <CRQ summary> <jiraUrl>
```

Then one line per change, in the order returned:

```
[<KEY>] <description> (#<PR-number>) by @<slack-handle> <emoji><suffix>
```

- Make `[<KEY>]` link to the ticket and `(#<PR-number>)` link to the PR using Slack
  mrkdwn: `[<{jiraBase}/browse/{KEY}|{KEY}>]` and `(<{prUrl}|#{number}>)`.
- **emoji** — `:white_check_mark:` if the change is release-ready, else `:loading-but-better:`.
  Release-ready = `statusDone` is true (ticket Done / Ready for Release) **OR** the PR
  has the `release: no-verification-needed` label.
- **suffix** — if the PR has the `release: no-verification-needed` label, append
  ` -- release: no-verification-needed` after the emoji. Otherwise no suffix.

Example output:

```
Preparing platform-integrations - 2026-06-15_002 https://babylonpartners.atlassian.net/browse/CRQ-5326
[STEP-11542] Select most recent completed encounter for AI-opted proctor session (#3134) by @zak.gogi :white_check_mark:
[STEP-11450] Review follow-up: renames, singleton, log cleanup (#3124) by @Victor Mora :white_check_mark: -- release: no-verification-needed
[STEP-11543] Skip SR status patch on treatment change escalation (#3129) by @Victor Mora :loading-but-better:
```

## Step 5 — Post to Slack

Show the assembled message and the resolved `target` to the user for a quick confirm
when the target was inferred. Then call `slack-sendMessage` with
`{ target, text, threadTs? }`. Report the returned permalink.

If the send fails (not a member of a private channel, or no Slack user matched),
surface the tool's error verbatim and suggest the fix (invite the token, use a
channel ID, or pass an email/user ID).

## Rules

- Tools do the work; the skill sequences them. No raw HTTP, no field-ID guessing,
  no re-implementing status/emoji logic outside the rules above.
- Match PRs **within the CRQ's repo only** — a ticket key can have PRs in several repos.
- One CRQ per run. For multiple, loop the steps per key.
