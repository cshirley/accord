---
name: commit
description: Stage all changes, generate a detailed commit message with context and decisions, then commit to the current branch. Use when the user asks to commit changes, create a commit, or save their work with a commit message.
---

# Detailed Commit

## Invocation

Commit flow uses **Pi tools from `pi-git`**, not shell git and not `accord-mcp` (`dev_*` only).

| Step | Tool name (exact) |
|------|-------------------|
| Gather context | `git_commit_context` |
| Stage + commit | `git_commit_execute` |

- **Pi TUI:** call those names from the agent tool list.
- **Cursor + pi package:** same names, often bridged as `mcp_pi_git_commit_context` / `mcp_pi_git_commit_execute`. Names are not truncated (`t_commit_execute` is invalid).
- **Do not** run `git add` / `git commit` in bash, and do not search MCP/bash to “find” these tools.
- If a tool is **not active**, call `search_accord_tools` first (progressive discovery), then use the exact tool name.
- If they are missing, ask the user to run `bun run install:pi-skills` (harness-free) or `pi install` **pi-git** from this monorepo.

## Format

```
[TICKET-ID] Short imperative summary (<72 chars)

Context:
Why — the problem, requirement, or goal.

Decisions:
- Key choices and trade-offs a reviewer should understand

Test areas:
- What could break, edge cases to verify
```

## Process

1. Call `git_commit_context` — gathers status, diff, log, branch, secrets, artifacts, ticket in one call
2. Review response:
   - **secretWarnings** non-empty → warn user
   - **ticket** null → ask user for ticket ID
   - **artifacts** present → enrich context (e.g. "Plan increment 3 done", "Spec finalised")
   - **suggestedFiles** → staging set (secrets pre-excluded)
3. Draft commit message from **diffStat**, **diff**, and **status**:
   - Context: what problem, why now
   - Decisions: alternatives considered, why this approach
   - Test areas: what could break
4. Present draft, **wait for user confirmation**
5. Call `git_commit_execute` with confirmed **suggestedFiles** and **message**
6. Confirm success from response

## Rules

- `[TICKET-ID] ` prefix, imperative mood, ≤72 char title
- Body: blank-line-separated sections, bullet points
- Focus on info not obvious from the diff
- Never amend unless user explicitly asks
- Always confirm before `git_commit_execute`

## Example

```
[STEP-10107] Add anonymous order preview endpoint

Context:
Patients need pricing before creating an account. Existing preview
requires auth, so a new anonymous path was needed.

Decisions:
- invoice_items over subscription_details (no active subscription yet)
- Phase mapped at service boundary to keep API contract clean
- Made serviceRequest optional to avoid duplicating order assembly logic

Test areas:
- Anonymous preview returns correct line items per phase
- Authenticated preview path unchanged (regression)
- Error handling when pricing plan has no phase items

Co-Authored-By: pi.dev (claude-sonnet-4/anthropic)
```
