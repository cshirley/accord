---
name: crq-notify
description: >
  Fetch a Jira CRQ (change request), resolve each linked change to its GitHub PR
  and Slack handle, and post a formatted release summary to Slack. Use when the
  user provides a CRQ key (e.g. CRQ-5326) or Jira URL and wants to announce,
  notify, or share a release/change request on Slack (#channel, DM, or thread).
disable-model-invocation: true
---

# CRQ notify

This file in `@clive.shirley/pi-skills` is the source of truth at
`packages/pi-skills/skills/crq-notify/SKILL.md`.

Deterministic work lives in **pi-integrations** tools — do not re-implement Jira
link extraction, status logic, channel resolution, or Slack delivery in ad hoc
HTTP or shell. This skill sequences tools, applies the emoji and mention rules
below, and sends one message per CRQ.

This skill may:

- read a CRQ and its linked changes via `atlassian-getCrqLinkedIssues`;
- search GitHub for PRs in the CRQ's repo and read PR metadata (number, title,
  labels, URL);
- resolve Jira assignees to Slack users via `slack-lookupUser`;
- post the assembled mrkdwn via `slack-sendMessage` (optionally as a thread
  reply);
- optionally read extra Jira fields via `atlassian-getJiraIssueFields` when the
  user also wants change-window or risk metadata in the message.

This skill must not:

- transition the CRQ or linked tickets;
- approve a CRQ or change Jira in any form;
- match PRs outside the CRQ's `repo` (ticket keys can exist in multiple repos);
- map Slack handles from GitHub PR authors (search APIs do not expose reliable
  email/name for that path);
- run raw Jira field-ID guessing or duplicate logic already implemented in
  `atlassian-getCrqLinkedIssues`.

Requires **pi-integrations** (install via
`bash scripts/install-pi-skills.sh --integrations` from the accord monorepo).

## Invocation

| Step | Tool |
| ---- | ---- |
| CRQ header + linked changes | `atlassian-getCrqLinkedIssues` |
| PR number, title, labels, URL | GitHub PR tools (e.g. `github_search_issues`, `github_get_pull_request`) |
| Assignee → Slack user ID | `slack-lookupUser` |
| Deliver message | `slack-sendMessage` |
| Optional extra CRQ fields | `atlassian-getJiraIssueFields` |

Run independent GitHub and Slack lookups in parallel where the host allows.

## Required inputs

| Input | Required | Notes |
| ----- | -------- | ----- |
| **CRQ key** | yes | e.g. `CRQ-5326` |
| **target** | yes | `#channel`, channel ID, `@display-name`, or email |
| **thread ts** | no | Reply inside an existing thread |

If either required input is missing, ask once, then proceed.

Default channel policy: use the user-supplied **target**. Do not invent a
channel when the user already named one. When **target** was inferred from
context, show the assembled message and resolved destination for a quick confirm
before `slack-sendMessage`.

For multiple CRQs in one user message, loop the full flow once per key.

## Build the change list

Call `atlassian-getCrqLinkedIssues` with the CRQ key. The tool returns the CRQ
header (`key`, `summary`, `status`, `owner`, `rollbackPlan`, `service`, `repo`,
`jiraUrl`) and `issues[]` (`key`, `summary`, `status`, `statusDone`, `issueType`,
`assignee`, `assigneeEmail`).

It collects changes from Jira issue links **and** the rich-text "changes" field
(smart-link cards and git-log blocks on service-release CRQs). Do not parse the
CRQ description manually.

- If `issues` is empty, post only the header block (see **Message format**) and
  tell the user there were no linked tickets.
- `repo` is the only GitHub repo to search (`emed-labs/<service>`).

## Resolve pull requests

For every issue in `issues`, find its PR **in the CRQ's `repo`**:

```text
github_search_issues  q: "repo:<repo> <KEY> in:title type:pr"
```

From the matching PR (if several, prefer the most recently merged), capture:

- `number` and `html_url` for `(#<number>)`;
- `title` as the change description (strip a leading `[<KEY>] ` to avoid doubling);
- `labels[].name` — note `release: no-verification-needed` and
  `release: requires-verification` when present.

If no PR is found, keep the change line but omit `(#PR)` and derive release-ready
emoji from `statusDone` alone.

## Resolve Slack mentions

Resolve from the change's **Jira assignee** (Step 1 output), not the GitHub PR
author, via `slack-lookupUser`:

1. Try assignee **display name** (works on any token).
2. If that misses, try **assigneeEmail** (needs `users:read.email` on the Slack
   token).

Keep the resolved **user ID** (e.g. `U06JSU66GUE`) and display name for
**Message format**. If no Slack user matches, you only have the display name.

## Message format

Use Slack mrkdwn. Link tickets and PRs as
`[<jiraBase>/browse/<KEY>|<KEY>]` and `(<prUrl|#number>)`.

### CRQ header

Omit `*Rollback plan*` when `rollbackPlan` is empty.

```text
*:rotating_light: Change Request — <KEY>*  (<status>)
*Summary:* <summary>
*Owner:* <owner>

*Rollback plan*
<rollbackPlan>
```

### Change inventory

After a blank line, start the list with:

```text
Preparing <CRQ summary> <jiraUrl>
```

Then one line per change, in tool order:

```text
[<KEY>] <description> (#<PR-number>) by <author> <emoji><suffix>
```

**Release-ready emoji**

- `:white_check_mark:` when the change is release-ready.
- `:loading-but-better:` otherwise.

Release-ready when `statusDone` is true (Done / Ready for Release) **or** the PR
has label `release: no-verification-needed`.

**Suffix**

When the PR has `release: no-verification-needed`, append
` -- release: no-verification-needed` after the emoji. Otherwise no suffix.

**Author rendering — ping only when there is something to action**

```text
needsAttention = (NOT statusDone) OR (PR has label "release: requires-verification")
```

| Condition | Render |
| --------- | ------ |
| `needsAttention` and Slack user ID known | `<@USER_ID>` (notifying mention) |
| otherwise | plain `@<display name>` (no ping) |
| no Slack user matched | plain `@<display name>` regardless |

Ping when the change is still in flight or requires post-release verification.
Do not ping when the change is done/ready and needs no verification.

Example:

```text
Preparing `platform-integrations` - 2026-06-15_002 https://babylonpartners.atlassian.net/browse/CRQ-5326
[STEP-11542] Select most recent completed encounter for AI-opted proctor session (#3134) by <@U06JSU66GUE> :white_check_mark:
[STEP-11450] Review follow-up: renames, singleton, log cleanup (#3124) by <@U05ALCV31LL> :white_check_mark: -- release: no-verification-needed
[STEP-11618] Enable ENABLE_MEDICATION_CONFIRMATION_FLOW (#3131) by @Victor Mora :white_check_mark: -- release: no-verification-needed
```

(STEP-11542: Done but requires verification → ping; STEP-11450: In Review →
ping; STEP-11618: Done, no verification → plain text.)

## Post to Slack

Call `slack-sendMessage` with `{ target, text, threadTs? }`. Report the returned
permalink.

If the send fails (private channel membership, unresolved user, etc.), surface
the tool error verbatim and suggest the fix (invite the app, use channel ID, or
pass email/user ID).

## Completion

Return the post permalink and stop. Do not emit evidence verdicts (`✅` / `☁️` /
`⚠️` / `⏳`) or re-evaluate the thread — that is **crq-release-prep**, not this
skill.
