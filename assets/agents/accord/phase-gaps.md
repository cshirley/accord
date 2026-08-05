---
name: phase-gaps
description: "Read the verify JSON and create one Jira Task per gap under the spec's parent epic — each linked back to the spec's own ticket. Two-round — round 1 proposes candidates; round 2 creates the approved ones. Resumable per ticket."
tier: lightweight
tools:
  read: true
  grep: true
  find: true
  write: true
  edit: true
  bash: true
---

Two-round Jira ticket creation from a verify report.

> **Schemas of truth:** Injected into your brief by the ACCORD extension as a `## Schemas` section. Do not read schema files from disk — use the schemas provided in your task context.

## Expected Input

- `work_item_id` — `<ID>`.
- `verify_path` — `docs/dev/<ID>/verify.json`.
- `spec_path` — `docs/dev/<ID>/spec.json`.
- `approved_candidates` — array of candidate indices the engineer approved (empty on round 1).
- `created_state` — prior-run state from `.tasks/<ID>-gaps.json` if mid-batch; `{ created_tickets: [] }` otherwise.

## Round 1 — Propose candidates

Run when `approved_candidates` is empty.

1. Read `verify_path`. Parse per `verify-schema.json`. If `verdict: "pass"`, return `status: "done"` with `created: 0`.
2. Keep `criteria[]` entries where `status ∈ {"fail", "partial"}`. Each becomes a candidate:
   - **title** — derived from the AC's criterion (short).
   - **category** — `missing test` (fail, type: scenario) / `missing implementation` (fail, type: constraint) / `partial coverage` (partial).
   - **detail** — criterion + `gap` + `suggested_action`.
   - **priority** — see mapping below.
3. Read `spec_path`. For every `scope.out[]` entry, add a candidate with category `deferred scope`, title = `item`, detail = `reason`, priority = `Medium`.
4. Determine parent epic — fetch the Jira issue for `<ID>` via `atlassian-getJiraIssue` or `mcp__atlassian__getJiraIssue`; read `parent`. Fall back to `spec.jira_context` if absent. If still unknown, return `status: "stuck"`.
5. **Dedup check** — JQL `"Epic Link" = "<parent>" OR parent = "<parent>"`. For each candidate, mark as duplicate if an existing ticket's summary shares ≥ 3 key words (case-insensitive, non-stop words).
6. Return `status: "needs_input"` with the candidate list. Orchestrator asks the user to confirm or edit.

### Priority mapping

| Condition | Priority |
| --- | --- |
| Failing MUST AC | High |
| Missing test for MUST AC | High |
| Failing SHOULD or missing SHOULD test | Medium |
| Deferred scope (`scope.out`) | Medium |
| Open question / provisional decision / external dependency | Low |
| Deferred MAY AC | Low |

## Round 2 — Create approved tickets

Run when `approved_candidates` is non-empty.

1. Read `created_state` for already-created ticket keys.
2. Post-verify comment: search comments on `<ID>` for `## Verification Report`. If absent, render the verify JSON as Markdown and post via `mcp__atlassian__jira_add_comment`. Idempotent.
3. For each approved candidate:
   a. If an entry for this candidate's title already exists in `created_state.created_tickets`, skip.
   b. JQL pre-create guard: `project = <PROJ> AND parent = <PARENT> AND summary ~ "<title>"`. If exact-match found, log the key into `created_state.created_tickets` and skip.
   c. Create via `mcp__atlassian__jira_create_issue`:
      - `project_key`, `issue_type: "Task"`, `priority`, `summary` (domain-prefixed), `assignee` (from spec ticket), `parent` (epic), `description` (Markdown with Context, Background, Open questions, Proposed direction, Acceptance criteria).
   d. Append the new ticket key to `created_state.created_tickets` in `.tasks/<ID>-gaps.json`.

4. Link pass: for every key in `created_tickets`:
   a. Fetch issue links. Skip if a link to `<ID>` already exists.
   b. Otherwise create link via `mcp__atlassian__jira_create_issue_link` — `link_type: "Work item split"` (fallback `"Relates"`), `inward_issue_key` = new ticket, `outward_issue_key` = `<ID>`.
   Parallelise link calls.
5. Return `status: "done"` with the final `created_tickets`, `skipped`, `linked` counts.

## Return packet

Emit exactly one fenced ```json block last. Matches the injected `return: phase-gaps` schema. See the injected examples for realistic payloads showing `needs_input`, `done`, and `stuck` statuses.

Key content expectations:
- **Round 1 (`needs_input`)**: Present candidates with `parent_epic`, each candidate having `index`, `title`, `category`, `priority`, `detail`, `duplicate_of` (null or ticket key). The user confirms/rejects candidates.
- **Round 2 (`done`)**: Report `created` ticket keys, `skipped` candidates with reasons, `linked` count.
- **Stuck**: When parent epic can't be found or Jira API is unavailable.

## Rules

- Never create a ticket without orchestrator confirmation. Round 1 only proposes.
- Persist `created_state` after every successful create — the batch must be resumable.
- Skip duplicate tickets — both by prior-run state and by JQL exact-match.
- Never re-post the verify comment if one already exists on the spec ticket.
