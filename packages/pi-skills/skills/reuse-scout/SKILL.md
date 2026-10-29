---
name: reuse-scout
description: Before building, find existing code, patterns and conventions to reuse in this repo and its sibling repos, and report them with a fit label (use as-is, extend, compose with, partial match). Use before planning or coding a new helper, client, config, ID scheme, cache or error handling, or when the user asks whether something already exists.
---

# Reuse scout

Find what already exists **before** new code is written. It answers questions that often arrive after the code is built: "do we already have this pattern?", "does another service solve this?", "is the thing we would extend still used?". Negative results count as evidence, so record what you searched.

Same output shape as the `phase-explore` agent, so the result feeds `phase-plan` and the `review-code` "Reuse compliance" check.

## Process

1. **State the need** in one sentence and list the concerns it touches. Check each of these:
   - identity and uniqueness (IDs, idempotency keys, unique indexes)
   - configuration, credentials and secrets patterns
   - HTTP, queue and database clients and wrappers
   - caching, retries, timeouts, circuit breakers
   - error mapping and logging
   - test helpers, fixtures and fakes
   - build, deploy and infrastructure modules
2. **Derive search terms.** Use nouns and verbs from the request, error strings, config keys, external service names, and the names a neighbour would use (synonyms). Prefer `rg` in bash.
3. **Search, in this order.** Record each search and its result count.
   1. The repo conventions: `AGENTS.md`, `okf/`, `docs/`, ADRs, and README files for the area.
   2. The code: `rg -n '<term>'` across the repo. Read at most 5 files per round.
   3. **Sibling repos** when the work sits in a multi-repo platform. Ask which ones if unknown. A common layout is repos next to each other under one parent directory (`../`).
   4. History for removed or renamed code: `git log -S'<symbol>' --oneline -n 5`.
4. **Classify each candidate.**

   | Fit | Meaning |
   |-----|---------|
   | `use as-is` | Call it directly. |
   | `extend` | Add to it (method, option, implementation). |
   | `compose with` | Wrap or delegate to it. |
   | `partial match only` | Similar concept, different signature or scope. Informational. |

5. **Check each candidate is alive.** Look at its last change (`git log -1 --format=%ad -- <file>`), how many callers it has (`rg -c`), and whether it is marked deprecated. A dead or deprecated candidate is `partial match only` at best.
6. **Check conflicts.** Note when two existing patterns disagree and the choice needs a decision. Record it in the brief's decision ledger instead of picking one silently.
7. **Report** with `file:line` references. Do not paste file contents.

## Output

```markdown
## Reuse candidates
| Symbol / pattern | Location | Fit | Evidence (callers, last change) | Note |
|---|---|---|---|---|
| `TransientUniquenessId` | `config/metadata/global.partial.ts:42` | use as-is | 6 callers, 2026-09 | backed by a unique index per resource |

## Searched
- `rg -n 'idempotency'` → 3 hits, none relevant
- Sibling repos: platform-services (checked), population-health (checked), documentation (not checked: not code)

## Decisions needed
- <pattern A> vs <pattern B>: <why it matters>
```

When a brief exists (`docs/dev/<ID>/brief.md`), write the table under its **Existing patterns to reuse** section. Optionally also save the machine form next to it as `docs/dev/<ID>/reuse.json`:

```json
{ "status": "done", "files": ["..."], "symbols": [{"symbol": "...", "file": "...", "line": 1}],
  "reuse_candidates": [{"symbol": "...", "file": "...", "fit": "extend"}] }
```

## Rules

- Search before you propose. Never answer "nothing exists" without listing what you searched.
- Prefer extending an existing pattern to adding a parallel one. A new pattern needs a stated reason.
- Do not copy code between repos. Point at the source and say whether it needs extracting.
- If the `phase-explore` subagent is available and the search is large, you may delegate with `search_terms` and `dirs`, then verify its top candidates yourself.
- Read-only: this skill changes no source files.
