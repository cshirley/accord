---
name: accord
description: ACCORD accord skill — when Pi forwards `/skill:accord` from `/dev`, orchestrates `subagent` spawns and `dev_*` tools. Subcommands init, align, spec, plan, resume, finish, check, gaps, review, deviations, amend-spec, spec-gaps, or default classify. Extension handles resume/finish locally by default (ACCORD_CORE_ORCHESTRATOR=0 for skill routing). State on `.tasks/` and `docs/dev/`. See docs/harness-orchestration.md.
model: sonnet
---

# ACCORD — accord skill (`/skill:accord`)

When `/dev …` forwards here, you drive **`subagent`** spawns and **`dev_*`** tools. **Disk state wins** (`.tasks/`, `docs/dev/<ID>/`); the user may `/clear` and continue with `/dev resume <ID>` (usually executed by the extension unless `ACCORD_CORE_ORCHESTRATOR=0` — see §Extension vs this skill).

## Pipeline overview

**`implement/standard` (high level):** `phase-align` → `phase-spec` → `phase-plan` → per-task (`phase-test` → optional `review-test` pre-impl → `phase-code` → optional `review-code`) → `/dev finish` → verify + closeout.

**Other patterns:** `implement/express` short-circuits to gather/code/verify; `quick_fix` uses `dev_quick_fix_brief` and optional test/review before code; `investigate` / `infra` / `analyse` follow the pattern table in §Subcommand: (default).

> **Schema injection is automatic.** The extension injects per-agent schema briefs from `src/core/agents/registry.ts` → `schemas/`. Do not paste raw schema files into the skill context.

## Runtime architecture

Pi loads **`subagent`**, the **ACCORD** extension, and **`notify`**. ACCORD hooks validate `.tasks/` + `docs/dev/` writes, track usage, validate agent return packets, run verify preflight before `phase-verify-*`, and run post-`phase-code` type-check (hard) + test (advisory). It reads **`## Dev Harness`** from `AGENTS.md` (refreshes on save). Without that block, stack-dependent subcommands are blocked with *No ACCORD config…* — run **`/dev init`**. Behaviour detail: **`docs/hooks-and-tools.md`**.

**You do not invoke hooks yourself.** Use **`subagent`** + **`dev_*`** tools; let extensions enforce gates.

### Extension vs this skill (routing)

- **Extension-local:** `help`, `tasks`, `retro`, `tag` — help text from **`DEV_HELP_TEXT`** (`src/core/commands/help.ts`).
- **Core orchestrator (default):** extension runs **`resume` / `finish`** spawns programmatically; on failure to plan, work arrives here. **`ACCORD_CORE_ORCHESTRATOR=0`:** **`resume` / `finish`** are skill-driven.
- **Free text:** same deterministic routing as **`dev_intent`** / **`classify-dispatch`** (`src/core/commands/classify-dispatch.ts`) before forward.
- **MCP:** **`dev_orchestrate`** returns JSON plans only — no subagent spawns over stdio (`docs/hooks-and-tools.md`).

Design: **`docs/harness-orchestration.md`**, **`docs/harness-orchestration-implementation-plan.md`**.

## Context budget

Hard rule: your working context is the work item JSON (~1 KB) + N agent summaries (~1–2 KB each). Do not read source files, spec/plan/verify bodies, or test output in this skill's context. Delegate to agents.

## Orchestrator tools

Registered **`dev_*`** tools share one canonical registry: **`src/core/tools/registry.ts`** — both the Pi adapter (**`src/adapters/pi/tools.ts`**) and the MCP adapter (**`src/adapters/mcp/register-tools.ts`**) iterate that array, so they cannot drift. Semantics: **`docs/hooks-and-tools.md`**.

**Surface:** `dev_tasks`, `dev_intent`, `dev_intent_enrich`, `dev_bootstrap`, `dev_rehydrate`, `dev_checkpoint`, `dev_review_queue`, `dev_retro`, `dev_finalize`, `dev_promote_events`, `dev_spec_gaps`, `dev_code_brief`, `dev_quick_fix_brief`, `dev_resume_state`, `dev_transition`, `dev_verify_summary`, `dev_nonce`, `dev_decision_packet`, `dev_init_detect`, `dev_init_write`, `dev_orchestrate`.

**Rules:** `dev_intent` before classifying free text — honour **`needs_confirmation`** / **`escalation_ceiling`**. Prefer **`dev_bootstrap`** / **`dev_transition`** over hand-editing JSON. Always **`dev_promote_events`** after **`phase-code`**. **`dev_finalize`** on terminal paths. Read-only dashboards via **`dev_tasks`**, **`dev_review_queue`**, **`dev_retro`**, **`dev_spec_gaps`** — do not re-parse those blobs by hand.

## Subcommand dispatch

Parse the first word of the forwarded input. **Extension-local** commands (`help`, `tasks`, `retro`, `tag`) normally never reach this skill — if the user asks anyway, defer to `DEV_HELP_TEXT` / `dev_tasks` / `dev_retro` / `/dev tag` behaviour.

| First word | This skill |
| --- | --- |
| `init` | §Subcommand: init |
| `align <ID>` | §Subcommand: align, spec, plan |
| `spec <ID>` | §Subcommand: align, spec, plan |
| `plan <ID>` | §Subcommand: align, spec, plan |
| `resume <ID>` | §Subcommand: resume |
| `finish <ID>` | §Subcommand: finish |
| `check <ID>` | §Subcommand: check, gaps, review, … |
| `gaps <ID>` | §Subcommand: check, gaps, review, … |
| `review` | §Subcommand: check, gaps, review, … |
| `deviations <ID> [accept \| revert] [task_id]` | §Subcommand: check, gaps, review, … |
| `amend-spec <ID>` | §Subcommand: check, gaps, review, … |
| `spec-gaps <ID>` | §Subcommand: check, gaps, review, … |
| _(empty)_ | Extension handles before skill — see §Extension vs this skill |
| anything else | §Subcommand: (default) — classify pattern, bootstrap work item, dispatch |

Mismatched subcommand + arguments (e.g. `spec` without `<ID>`) → ask for the missing piece. Never guess the work item ID.

Unless **`ACCORD_CORE_ORCHESTRATOR=0`**, `resume` / `finish` may not reach this skill if the extension resolves the spawn chain locally (§Extension vs this skill).

**Empty input** (`/dev` with no args): handled by the extension (`dev_dispatch`). Never classify or bootstrap on empty input.

---

## Subcommand: help

`/dev help` is printed by the extension from **`DEV_HELP_TEXT`** (`src/core/commands/help.ts`). If the user asks for help inside an accord skill session, **repeat that routing summary** (local vs core orchestrator vs skill vs free text) and the subcommand list from `DEV_SUBCOMMANDS` — do not spawn agents.

---

## Subcommand: init — detect stack, write AGENTS.md

1. Call **`dev_init_detect`** (cwd inferred). If **`proposed_config`** is `null`, show **`formatted_summary`** and stop.
2. Walk **`placement`**: offer root vs local vs link vs replace per tool output; store the chosen **`dev_init_write`** `target`.
3. Optional **`global_context_sources`**: collect project scoping or disable entries; only persist `context_sources` when the user changes defaults.
4. If **`proposed_config.tracker`** is missing, ask tracker + prefix and patch the config object.
5. Confirm **`formatted_summary`**; user may amend fields **without** re-running detect until **`dev_init_write`**.
6. If `target` is **`root_replace`**, confirm diff; on decline, fall back to **`local`**.
7. Call **`dev_init_write`** with final `config`, `target`, `cwd`, and `git_root` (required when `target` ≠ `"local"`). Print the tool **`summary`**.

Source of truth for fields and placement enums: **`src/core/config/init-detect.ts`**, **`src/core/config/init-write.ts`**. User guide: **`docs/configuration.md`**.

---

## Subcommand: (default) — classify and dispatch

1. **`dev_intent(free_text)`** — treat output as the intent contract. Classification logic: **`src/core/commands/intent.ts`**. Respect **`needs_confirmation`** (explicit tokens, not bare yes/no), **`escalation_ceiling`**, **`target_paths`**, **`out_of_scope`**.
2. **Ticket enrichment:** if confidence is `medium`/`low`, input matches a ticket id, and mode is `pipeline` or `narrow_change`, fetch ticket metadata then **`dev_intent_enrich`**. On tracker failure, skip enrichment and continue.
3. **Work item id:** prefer a ticket-shaped id (`[A-Z]+(-[A-Z]+)*-\d+` — see **`src/core/commands/classify-dispatch.ts`** / **`src/core/work-items/lifecycle.ts`**). If missing: ask on ticket-shaped flows; else mint a keyword slug (`KEYWORD-1`, bump suffix if `.tasks/<ID>.json` exists) for modes that persist work.
4. **`dev_resume_state(id)`** — rehydrates from `docs/dev/<id>/` when `.tasks/` is missing (then announce **`phase`** and dispatch). If no recoverable artifacts, **`dev_bootstrap`** with id, title, pattern, variant, and intent fields from `dev_intent`. Explicit recovery: **`dev_rehydrate(id)`** or **`/dev rehydrate <id>`**.
5. **Never** bootstrap on empty input (extension-only). Ambiguous scope → top-2 ask; do not promote `narrow_change` / `review` / `explain` / `investigate` into **`pipeline`** without explicit user consent.

### Pattern composition

| Pattern/Variant | Sequence |
| --- | --- |
| `implement/express` | gather → code → verify-code → review-code → report |
| `implement/standard` | align\* → spec\* → plan\* → per-task (test → review-test → code → review-code → verify-code) → finish |
| `implement/orchestrated` | align\* → spec\* → plan\* → parallel (test → review-test → code → review-code) per worktree → sequential merge → finish |
| `quick_fix` | (test or review-test) → review-test → code → review-code → verify-code → report |
| `investigate` | gather → explore → hypothesise → test → report |
| `infra` | gather → explore → code (IaC) → verify-infra → report |
| `analyse` | gather → explore → draft (inline — orchestrator assembles the design doc) → review-design → report |
| `thinking_partner` | conversational — no pipeline |

| Pattern | Variant | Entry phase |
| --- | --- | --- |
| `implement` | standard / orchestrated | `speccing` |
| `implement` | express | `implementing` |
| `quick_fix` | — | `fixing` |
| `investigate` | — | `gathering` |
| `infra` | — | `exploring` |
| `analyse` | — | `researching` |

`*` Multi-turn checkpoints — §Multi-turn checkpoints. **review-test** and **review-code** are mandatory per task (harness-enforced). Critical findings on review agents retry **phase-test** / **phase-code** per **`orchestration.review_loop`** (default cap 3).

### Multi-turn checkpoints

Phases marked `*` in the pattern table use **`dev_checkpoint`** when the agent returns `needs_input`, `stuck`, or similar pauses. The user continues with **`/dev resume <ID>`** (extension or skill). Checkpoint field semantics live in the phase agent markdown — do not duplicate them here.

### Phase-to-agent map

| Phase | Agent |
| --- | --- |
| align | `phase-align` (delegates to `phase-gather` when needed) |
| explore | `phase-explore` |
| spec | `phase-spec` |
| plan | `phase-plan` |
| test (implement) | `phase-test` |
| test (investigate) | `phase-test` (hypothesis path) |
| code | `phase-code` |
| verify-code | inline Bash — `verification.commands` from spec |
| verify-acceptance | `phase-verify-acceptance` |
| verify-infra | `phase-verify-infra` |
| hypothesise | `phase-hypothesise` |
| draft | inline — design doc assembly (`analyse`) |
| gaps | `phase-gaps` |
| finish | `dev_review_queue` + `dev_tasks` + `phase-verify-acceptance` + `dev_verify_summary` + `dev_finalize` (same sequence the extension runner uses when it owns finish) |
| report | inline — `dev_decision_packet` / user messaging |

**Spawn shape:** `{ agent: "<registry-id>", task: "<brief>" }`. Parallel / chain payloads follow the `subagent` tool contract. By default the extension calls the same spawns programmatically for `resume` / `finish` — **disk state is still authoritative**.

Hooks validate return packets, append usage, recompute `cost_usd`, and run verify/type-check gates — **do not** reimplement those scripts in the skill.

### Policy source of truth (loops)

- **Quick-fix test↔review:** `orchestration.quick_fix_loop` in AGENTS.md (`max_test_review_loops`, default **5**; `severity_gate`). Persisted counter **`test_review_cycles_used`** on the task file. Implemented in core (`policy.ts`, `quick-fix.ts`) and hooks — **never** invent a parallel "max 2 respawns" cap in prose.

- **Implement `review-code` gate:** `orchestration.implement_loop` + `phase-code` return packets (`implement-phase-code.ts`). After every **`phase-code`**, call **`dev_promote_events`**.

### Per-task execution (when *you* spawn subagents)

1. Assemble briefs with **`dev_code_brief`** or **`dev_quick_fix_brief`**; spawn the agent the tool names.

2. Read each return packet; follow **`assets/agents/accord/<agent>.md`** + `schemas/return-schemas/<agent>.json`.

3. After **`phase-code`**: **`dev_promote_events`**. On terminal success paths, **`dev_transition`** / **`dev_finalize`**; on stall/block, **`dev_decision_packet`**.

4. If the task may already be on **`review-code`** because core applied **`implement_loop`**, **`dev_resume_state`** before choosing the next spawn.

5. Optional post-impl **`review-code`** / **`review-test`** (post-impl mode) when reviews were requested — non-blocking for the next task unless policy or user says otherwise.

### Subcommand: align, spec, plan

1. **`dev_resume_state`**. Spawn **`phase-align`**, **`phase-spec`**, or **`phase-plan`** according to work item / checkpoint state.

2. Obey gather delegation when **`phase-align`** returns `needs_gather` → spawn **`phase-gather`** per that agent.

### Subcommand: resume

1. **`dev_resume_state(<ID>)`**.

2. Spawn the **registry agent** implied by coarse + per-task state. For read-only parity with extension routing, see **`src/core/orchestration/resume-resolve.ts`**.

### Subcommand: finish

1. **`dev_review_queue`** / **`dev_tasks`** as needed for blockers.

2. Spawn **`phase-verify-acceptance`** (verify preflight runs in hooks first).

3. On success: **`dev_verify_summary`**, **`dev_finalize`**. Route gaps / decisions per agent output.

### Subcommand: check, gaps, review, deviations, amend-spec, spec-gaps

| Subcommand | Flow |
| --- | --- |
| `check <ID>` | Use `dev_resume_state`; spawn verifying / acceptance agents appropriate to the WI phase (often **`phase-verify-acceptance`**). |
| `gaps <ID>` | Two-round **`phase-gaps`** — `assets/agents/accord/phase-gaps.md`. |
| `review` | Drain **`dev_review_queue`**; spawn decision/review agents per pending items. |
| `deviations …` | Follow tail arguments; use **`review-deviation`** when applicable (`assets/agents/accord/review-deviation.md`). |
| `amend-spec <ID>` | Mid-implementation spec amendments — follow amend-spec + `phase-spec` playbooks under `assets/agents/accord/`. |
| `spec-gaps <ID>` | Run **`dev_spec_gaps`**; present results and offer spec follow-up if needed. |

### Further reading

- **Agent bodies:** `assets/agents/accord/*.md`
- **Harness architecture:** `docs/harness-orchestration.md`, `docs/harness-orchestration-implementation-plan.md`, `docs/hooks-and-tools.md`
