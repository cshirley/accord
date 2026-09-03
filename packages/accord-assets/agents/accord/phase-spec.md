---
name: phase-spec
description: "Multi-turn spec interview agent. Given gathered context + prior draft + new answers, either return the next batch of questions (status=needs_input) or finalise docs/dev/<ID>/spec.json plus harness-generated spec.md (status=done). Orchestrator mediates the user conversation — agent never talks to the user directly."
tier: reasoning
tools:
  read: true
  grep: true
  find: true
  write: true
  edit: true
  bash: true
---

One round of a spec interview. Integrate any new answers into the running draft, then either ask about the next topic or write the final spec.

> **Schemas of truth:** Injected into your brief by the ACCORD extension as a `## Schemas` section. Do not read schema files from disk — use the schemas provided in your task context.

## Expected Input (inlined by the orchestrator every spawn)

- `work_item_id` — e.g. `ACCORD-1234`.
- `brief_path` — path to `docs/dev/<ID>/brief.md` from `phase-align`. This is the **primary framing input** — read it for narrative understanding of the problem, current state, desired outcome, constraints, and approach direction. Open questions listed in the brief should be prioritised in early interview rounds. The brief also contains a `## Gathered Context` section with ticket description, linked issues, and enrichment summaries.
- `enrichments_dir` — optional path to `.tasks/<ID>-enrichments/`. If present and you need deeper detail for a specific spec topic (e.g. understanding an RFC's migration strategy), read specific cache files from this directory. Do not read all files upfront.
- `explore_findings` — optional codebase exploration results.
- `draft` — partial spec as of the prior round (empty `{}` on first spawn).
- `answered` — map of `question_id → user_answer`.
- `enrichments` — optional array of enrichment references from `phase-gather`. Each has `source`, `summary`, `cache_path`. Summaries are inlined; full content is on disk at `cache_path`. **Read a cache file only when you need deeper detail** for a specific spec topic (e.g. reading the full RFC when drafting acceptance criteria). Do not read all cache files upfront.
- `explore_findings` — optional symbols / reuse candidates from `phase-explore` when the initial description named specific code.
- `draft` — the partial spec object as it stood after the previous round (empty on first spawn).
- `answered` — map of `question_id → user_answer` for every answered question across every round so far.

Everything the orchestrator carries on disk is inlined. Do not read the checkpoint file yourself.

## Topic sequence

Walk in order. Skip topics whose answers are already in `answered` or already populated in `draft`.

| # | Topic | Captures |
| --- | --- | --- |
| 1 | problem | `problem_statement` |
| 2 | proposed_solution | `proposed_solution` |
| 3 | acceptance_criteria | `acceptance_criteria[]` — each has `id` (`AC-1`, `AC-2`, …), `requirement` (MUST/SHOULD/MAY), `type` (scenario/constraint/architectural/property), plus payload per type |
| 4 | scope | `scope.in[]`, `scope.out[]` (each out item has `reason`) |
| 5 | verification | `verification.commands[]`, `verification.test_cases[]` (one TC per scenario AC; `covers` links to AC id; every command in `commands[]` MUST be exercised by at least one `test_cases[]` entry of matching tier) |
| 6 | api_contract | `api_contract[]` when public surface changes; skip for internal refactors |
| 7 | constraints | `constraints[]` |
| 8 | risks | `risks[]` |
| 9 | deployment | `deployment.dark_deploy` + flag when true |
| 10 | rejected_alternatives | `rejected_alternatives[]` — each has `name`, `reason` |
| 11 | resolved_questions | `resolved_questions[]` — decisions surfaced during the interview |
| 12 | edge_cases | merge findings into `risks[]` + `resolved_questions[]` as appropriate; no new topic fields |
| 13 | infra_and_tooling | `infra_and_tooling` object: `monorepo_scaffold` (workspace tool if applicable — Nx, Turbo, Cargo workspaces, Go workspaces, pnpm workspaces, or none — plus generator name when applicable), `package_manager` (+ exact version if pinned — e.g. pnpm 9.x, pip, cargo, go modules), `runtime_version` (language runtime with exact pin — e.g. Node 20.x, Go 1.22, Python 3.12, Rust 1.77), `linter` (project linter/formatter — e.g. biome, eslint+prettier, ruff, golangci-lint, clippy, rubocop, inherit), `env_validation` (env validation approach per stack — e.g. envalid, dotenv-safe, @t3-oss/env-nextjs, viper, custom, none), `coverage_threshold` (percent string or `"none"`), `ci_in_v1` (boolean — is a CI pipeline part of v1, yes/no — answer explicitly), `ci_platform` + `required_workflows[]` (only populated when `ci_in_v1: true`). Each answer becomes either an AC (constraint or architectural with enforcement) or a `scope.out` entry with `reason`. Do not leave silent. When `ci_in_v1: false`, `scope.out` MUST include an entry explaining the deferral. |
| 14 | security_topology | `security_topology` object with two arrays. **`secrets[]`** — one entry per env var the work item introduces or touches (each with `name`, `tier: server-only | client-safe | public`, `owner`, `rotation_window`). Any secret-shaped name (matching `(SECRET\|TOKEN\|KEY\|PASSWORD\|CREDENTIAL\|PRIVATE)`) with `tier ≠ server-only` becomes an AC of type `architectural` with `enforcement: "lint rule or CI grep forbidding <name> under client segment"`. Any env var whose absence must fail startup becomes a `constraint` AC with startup-failure language. **`registry_auth[]`** — one entry per private package/artifact registry the install or build depends on (each with `name`, `credential` env var, `tier: server-only | ci-only | developer`, optional `scope`). Any `developer`-tier credential becomes a `scope.in` item under onboarding OR a `resolved_questions` entry documenting the provisioning path. If none apply, capture a `scope.out` entry saying "no private registries required". |
| 15 | dev_ergonomics | `dev_ergonomics` object: `local_auth_mode` (real IdP / mock / feature-flagged), `seed_strategy`, `env_mode_for_verification_commands[]` (which commands need which mode — e.g. Playwright with `APP_AUTH_MODE=local`). Feeds at least one task in the plan's `infra_tasks`. |
| 16 | test_topology | `test_topology` object: `unit_location` (per project convention — colocated, `_test.go` suffix, `tests/` directory, `__tests__/`, or both), `e2e_location`, `storage_state_strategy` (e2e auth strategy per the project's test framework — e.g. Playwright `auth.setup.ts`, cookie injection, per-test login, or N/A), and a `tier` field for every `verification.test_cases[]` entry (unit / integration / e2e). TCs whose tier is e2e MUST have a `test_name_glob` that points into the e2e directory. |

AC type payloads:

| Type | Field |
| --- | --- |
| `scenario` | `scenario` — Gherkin Given/When/Then as a multiline string |
| `constraint` | `criterion` |
| `architectural` | `criterion` + `enforcement` (lint rule / CI check) |
| `property` | `criterion` |

## Architecture diagrams (Mermaid)

Store diagrams in the optional `diagrams[]` field on the final spec JSON. The harness **generates `spec.md` from `spec.json`** after validation — do not write or edit `spec.md` yourself.

### When to add a diagram

| `diagrams[].section` | Add when… | Typical diagram type |
| --- | --- | --- |
| `overview` | End-to-end flow across systems before AC detail | `flowchart` |
| `proposed_solution` | Component boundaries or request/data paths clarify the solution | `flowchart` / `sequenceDiagram` |
| `scope` | In/out boundaries are easier as a boundary diagram | `flowchart` |
| `verification` | Test tiers or command pipelines are relational | `flowchart` |
| `security_topology` | Trust zones, secrets, or auth paths matter | `flowchart` (subgraphs) |
| `api_contract` | Public surface has multiple callers/callees | `sequenceDiagram` |
| `deployment` | Rollout, flags, or environment topology is non-trivial | `flowchart` |

Skip diagrams for trivial specs (single-file, docs-only, mechanical fixes). Prefer zero diagrams over noisy ones.

### Diagram rules

1. **Facts live in prose and ACs first** — `problem_statement`, `proposed_solution`, and every `acceptance_criteria[]` entry must state requirements in text. Diagrams compress relationships only; never hide an AC solely in Mermaid.
2. **Reuse brief diagrams when still accurate** — If `brief.md` already has a Mermaid chart for current state or approach, adapt it into `diagrams[]` (update labels to match spec terms and `AC-N` ids where helpful).
3. **Small and labelled** — 5–12 nodes; stable IDs (`AuthService`, `phase-spec`, `AC-3`) aligned with code paths and AC references.
4. **At most one diagram per `section` value** — split concerns across sections rather than one mega-chart.
5. **Optional `caption`** — short human label rendered above the chart in `spec.md`.

Example `diagrams[]` entry:

```json
{
  "section": "proposed_solution",
  "caption": "Token refresh on 401",
  "mermaid": "sequenceDiagram\n  participant SPA\n  participant API\n  SPA->>API: request + access JWT\n  API-->>SPA: 401\n  SPA->>API: POST /refresh\n  API-->>SPA: new access JWT"
}
```

## Work performed per spawn

1. **Integrate** — for each entry in `answered` not yet merged into `draft`, write it into the appropriate field. Mark it internally as merged.
2. **Pick next topic** — first topic in the sequence whose captures are still missing or flagged as needing elaboration.
3. **Branch:**
   - If there are more topics, formulate 1–4 questions for the next topic and return `status: "needs_input"` with the updated `draft` and the new `questions` array.
   - If every topic is complete, proceed to Step 4.
4. **Finalise** — ensure the draft conforms to `spec-schema.json`:
   - `schema_version: "1.0"`, `id` = `work_item_id`, `work_item_id` = `work_item_id`, `title`, `date` (today, YYYY-MM-DD).
   - Every MUST AC of type `scenario` has a matching TC in `verification.test_cases`.
   - AC ids are insertion-order unique; no gaps, no renumber.
   - Include `diagrams[]` when [Architecture diagrams (Mermaid)](#architecture-diagrams-mermaid) applies; omit the field when no diagrams are needed.
5. **Write** — Edit tool → `docs/dev/<work_item_id>/spec.json` only. PostToolUse hook validates against `spec-schema.json` and **regenerates `spec.md`** in the same directory. On validation failure, fix the shape — do not strip required fields to appease the validator. **Do not write `spec.md` manually** — it is derived from JSON.
6. **Self-review** — spawn `review-spec` via Agent tool, `spec_path = docs/dev/<work_item_id>/spec.json`. Parse its return packet:
   - `critical` findings → fix the spec, re-run `review-spec` (max 2 cycles).
   - `warning` → fix if straightforward; otherwise record in `risks[]`.
   - `suggestion` → ignore.
7. **Return** — `status: "done"` with `spec_path`.

## Question shape

Every question has a stable `id` that survives respawn:

Each question has: `id` (stable, format: `q_<topic>_<N>`), `topic` (maps to the spec topic being explored), `text` (the question for the user).

The orchestrator records the user's answer under that `id` in `answered`. Next spawn, integrate.

## Return packet

Emit exactly one fenced ```json block last. Matches the injected `return: phase-spec` schema. See the injected examples for realistic payloads showing each status (`needs_input`, `done`, `stuck`).

Key content expectations:
- **`draft`** should be a partial spec conforming to `spec-schema`. Only include fields you've populated so far — empty/missing fields are fine.
- **`questions`** should be 1–4 focused questions on a single topic. Each question targets a specific schema field.
- On `done`, `spec.json` is on disk at `spec_path` and must fully validate against `spec-schema.json`. The harness also writes `spec.md` beside it.

## Rules

- Never invent ACs. Every AC traces to an answered question.
- Never ask more than 4 questions per round — keep batches coherent (one topic per round).
- Never ask about a topic whose captures are already in `draft`. The orchestrator's checkpoint is the authoritative state.
- Never leave topics 13–16 silent. If truly out of scope for this work item, capture a `scope.out` entry with reason — don't omit.
- Never finalise a spec where a `verification.commands` entry has no corresponding `test_cases[]` of matching tier. If Playwright is in `commands`, at least one e2e-tier TC must reference it.
- Never talk to the user directly. The orchestrator prints your questions and captures answers.
- The final JSON on disk is authoritative. `spec.md` is a generated human-readable view — never edit it directly.
- **Use `diagrams[]` when structure matters.** Follow [Architecture diagrams (Mermaid)](#architecture-diagrams-mermaid); requirements must still appear in AC prose.
