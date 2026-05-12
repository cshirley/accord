# ACCORD research and design decisions

The research that drove ACCORD and the design decisions that emerged while building it. Reference document — no command-level detail. For the as-built workflow, see [`accord-workflow.md`](accord-workflow.md).

---

## Table of Contents

1. [Why ACCORD Exists](#why-accord-exists)
2. [Scope: One Pattern, Done Properly](#scope-one-pattern-done-properly)
3. [Anchors From the Research](#anchors-from-the-research)
4. [Design Decisions That Emerged in the Build](#design-decisions-that-emerged-in-the-build)
5. [What Got Cut, and Why](#what-got-cut-and-why)
6. [Open Questions](#open-questions)

---

## Why ACCORD Exists

The original `dev-*` skill chain was the working prototype. It proved that a phased pipeline (spec → plan → impl → verify → gaps) with adversarial sub-agents could ship features without the engineer holding context across all phases. It also exposed three problems that no amount of skill-level engineering could fix:

1. **Skills accumulate context.** Every phase ran in the same conversation, so by `dev-verify` the model was carrying the spec interview, exploration notes, increment retries, and quality-gate findings. Recovery from `/clear` worked but threw away the accumulated reasoning.
2. **State lived in markdown frontmatter.** YAML phase markers (`phase: final`, `increments[N].status`) were brittle, hand-edited, and unvalidated. Mismatches between document state and reality were silent.
3. **Each skill re-implemented orchestration.** `dev-spec`, `dev-plan`, and `dev-impl` each had their own retry loops, sub-agent dispatch, and recovery procedures — duplicated logic, drift between skills.

ACCORD is what happens when you keep the workflow shape from the prototype but rebuild the substrate underneath it: schemas instead of frontmatter, isolated subagent processes instead of in-context delegation, a single thin orchestrator instead of one-per-skill.

> **ACCORD**: **A**gentic **C**ontract for **C**ollaborative **O**bjectives, **R**equirements, and **R**igorous **D**elivery.
> *Reach ACCORD before you build.*

The contract framing is deliberate. The spec and plan are not documentation — they are the agreed-upon contract that the implementation and verification agents are evaluated against. The harness's job is to make that contract machine-readable, immutable after approval, and traceable end-to-end.

---

## Scope: One Pattern, Done Properly

A taxonomy of senior engineering work identifies seven interaction patterns covering ~100% of the role (feature implementation, investigation, analysis, infrastructure, response, migration, thinking partner). ACCORD does **not** try to deliver all seven. It commits to the pattern that benefits most from a heavy harness — IMPLEMENT — and provides building blocks the other patterns can borrow.

| Pattern             | % of work | ACCORD coverage                                                     |
| ------------------- | --------- | ------------------------------------------------------------------- |
| **IMPLEMENT**       | ~50%      | Full pipeline (spec, plan, code, verify-acceptance)                 |
| **INVESTIGATE**     | ~9%       | `phase-explore` + `phase-hypothesise` + `review-investigation`      |
| **ANALYSE**         | ~15%      | `phase-spec` (broadened) + `review-design`                          |
| **INFRASTRUCTURE**  | ~4%       | `phase-verify-infra` (preview-only, never auto-applies)             |
| RESPOND             | ~12%      | Out of scope — see *What Got Cut* below                             |
| MIGRATE             | ~4%       | Out of scope                                                        |
| THINKING PARTNER    | ~6%       | Out of scope (no harness needed)                                    |

The IMPLEMENT pipeline is the one where the cost of getting it wrong is highest (re-work, missed ACs, silent spec drift) and where structural enforcement pays back most. RESPOND and MIGRATE are out of scope because they don't benefit from a contract — the contract *is* the diff.

ACCORD's bet: build the IMPLEMENT pipeline rigorously enough that the building blocks (subagent isolation, JSON state, schema validation, evidence-based review) are reusable for the other patterns when they're added later.

---

## Anchors From the Research

Six principles are load-bearing for ACCORD. Each one shaped a concrete decision in the codebase.

### P0: Protect Flow State

**Principle:** The 23-minute recovery cost of an interruption is the dominant constraint. Every gate must justify its attention cost.

**How ACCORD applies it:**

- **Two human gates only.** Spec/plan approval and PR review are synchronous. Everything else is autonomous — escalations and deviations land in a decision queue that the engineer batches.
- **Self-contained decision packets.** Phase agents return a structured packet (verdict + summary + evidence) so the engineer can decide in seconds without re-reading the full transcript.
- **Silent-by-default notifications.** The Pi extension only notifies on three events: pending decisions, post-code verification failures, and asset bootstrap restart-required. Everything else is `info` log only.

### P1: Spec Quality

**Principle:** The spec is the single largest lever for autonomy. Round-tripping "that's not what I meant" is the most expensive failure mode.

**How ACCORD applies it:**

- **Spec is a JSON schema, not prose.** `acceptance_criteria` are typed (`scenario`, `constraint`, `architectural`, `property`) with `requirement` levels (`MUST`, `SHOULD`, `MAY`). Every AC has a stable id (`AC-1`, `AC-2`, …) that flows through plan tasks (`covers_ac`) and verification (`criteria[].ac_id`).
- **Spec is immutable after approval.** Once `phase-spec` returns `done`, the file is committed under `docs/dev/<ID>/spec.json` and treated as the contract. Drift detection compares verification evidence against the *spec*, not the tests.
- **`review-spec` runs before approval.** Eleven-dimension check (AC↔TC coverage, scope coherence, constraint consistency, completeness, no lost context). Issues block the approval gate, not the implementation.

### P2: Structural Enforcement (Shifted Left)

**Principle:** Push every check that *can* be deterministic into a tool. Reserve agents for what tools cannot reach.

**How ACCORD applies it:**

- **Schema validation on every artifact write.** A Pi `tool_use` hook intercepts writes to `docs/dev/<ID>/{spec,plan,verify}.json` and rejects malformed artifacts before they reach disk. Bad data cannot enter the pipeline.
- **Return-value schemas per agent.** Every phase and review agent has a `schemas/return-schemas/<agent>.json` that the orchestrator validates on receipt. Malformed agent output retries inside the agent's own context window — never propagates to the engineer.
- **Verify preflight.** Before `phase-verify-*` is dispatched, the harness checks that required commands (`bun test`, `tsc`, etc.) exist and exit zero on a no-op invocation. Missing infrastructure is caught before the agent burns tokens trying to use it.
- **Provider preflight.** Before `phase-gather`, the harness checks that the configured tracker (Jira/GitHub/GitLab) and enrichment sources (Slack/Google Docs/Confluence/Figma) have working MCP tools, CLI fallbacks, or env vars. The agent receives an absolute path to the relevant playbook.

### P3: TDD + Test Quality

**Principle:** Tests are the primary feedback loop that lets agents self-correct without human intervention. Without coupled tests, TDD is advisory.

**How ACCORD applies it:**

- **`phase-test` runs before `phase-code`.** Tests are designed first, mapped to ACs via `covers_ac`. The test file is required to exist before code-time gates pass.
- **`review-test` runs in parallel with `review-code`.** Independent reviewers prevent rationalisation across concerns: a test reviewer that sees the code review may downgrade weak assertions.
- **Mutation testing is a CI concern, not a harness concern.** ACCORD intentionally does not run Stryker/mutmut inline — that's the language profile's job, surfaced by the engineer's existing CI.

### P4: Context Engineering

**Principle:** Performance degrades as context fills. Isolate phases. Persist state in JSON, not conversation.

**How ACCORD applies it:**

- **Every phase is a fresh subagent process.** Phase agents are dispatched via the `subagent` extension, each running in its own Pi process with its own context window. Nothing accumulates across phases.
- **Orchestrator carries only JSON.** The `accord` skill itself holds the work item file (~1KB), the spec slice the next phase needs, and the agent's structured return value. Total orchestrator context is well under 5% of the window even mid-pipeline.
- **Briefs are constructed, not concatenated.** Each phase agent receives a tailored brief built from the work item, the relevant slice of the spec/plan, the active decisions, and the preflight report. The agent never sees the prior conversation.

### P5: Adversarial Review

**Principle:** The author is compromised. Separate generator from evaluator. Require evidence-based findings.

**How ACCORD applies it:**

- **Eight review agents, all read-only.** `review-spec`, `review-plan`, `review-code`, `review-test`, `review-security`, `review-investigation`, `review-design`, `review-deviation`. Each runs in a fresh process with no write tools.
- **Findings without `file` + `line` are auto-downgraded.** The schema enforces this — there is no path to ship a `critical` finding without a citation.
- **`review-deviation` is new in ACCORD.** When a code agent makes a non-blocking divergence from the plan (renamed parameter, extracted helper), it emits a `deviation` event. `review-deviation` evaluates whether the deviation should be accepted, reverted, or refined — surfacing it as a decision in the queue.

### P6: Acceptance Verification

**Principle:** Tests pass and reviews are clean — but did we build what was asked for? The verification gate maps implementation back to the spec, not the tests.

**How ACCORD applies it:**

- **`phase-verify-acceptance` is the final phase.** Reads the spec, reads the code and tests, runs the suite, and emits a per-AC pass/fail/partial verdict with evidence (test name, file:line, lint rule).
- **Gaps are derived from criteria.** Criteria with `status: fail` or `partial` carry `gap` and `suggested_action` fields. The gap list is computed by filtering at render time — single source of truth.
- **`verify.json` is a committed artifact.** The decision packet, the PR comment, and the gap-tracking step all read from the same file.

---

## Design Decisions That Emerged in the Build

These decisions were not in the original blueprint. They surfaced during implementation and are worth recording because they shape how the harness behaves.

### 1. Skill-as-orchestrator, not extension-as-orchestrator

The blueprint imagined `/dev` itself routing each phase. In practice the routing logic is large enough that bundling it into the extension would require rebuilding it on every change. Splitting it: the extension owns deterministic concerns (validation, hooks, status, telemetry); the `accord` skill owns orchestration (spawning phases, processing returns, multi-turn loops). The extension forwards `/dev` to `/skill:accord` for any non-deterministic subcommand.

This means the orchestration logic is editable as a markdown skill and survives extension reloads. It also means a different harness can swap the skill out without changing the extension.

### 2. Subagent dispatch via the `subagent` extension, not raw `Task`

Pi's `Task` tool spawns subagents but does not enforce profile overrides per skill. The `subagent` extension provides a `subagent.json` mechanism that applies per-skill profile rules (model selection, tool allowlist, namespace) by walking the agent discovery tree. ACCORD's agents live under `assets/agents/accord/` and are tagged `namespace = "accord"` automatically — `subagent.json` then applies the right model/tool profile to each phase without per-agent frontmatter.

This is a small detail but it means every phase agent is configured *uniformly* without the agent files knowing they're part of ACCORD.

### 3. Providers are config-driven, not hardcoded

The blueprint had `TRACKER_DEPS` / `ENRICHMENT_DEPS` const maps in TypeScript — every new tracker required a code change. The shipping design replaced those with JSON sidecars (`assets/providers/{trackers,enrichments}/<name>.json`) paired with markdown playbooks. Projects can add or override providers via `accord.json` without touching the extension.

This unlocks two things: (a) custom in-house trackers (Linear, Shortcut, internal systems) without forking, and (b) provider-level scoping in the project config (e.g. `slack` enabled with a fixed channel allowlist).

### 4. Asset auto-install at session start

The blueprint had bundled assets (skills, agents, providers) but no installation story — the engineer had to run a script. The shipping design adds a `session_start` bootstrap that compares the installed manifest checksum against the bundled one and re-links on drift, notifying the user that a Pi restart is needed to pick up freshly linked assets.

This is mundane but significant: it removes most manual setup. Cloning the repo, running **`pi install <path-to-repo>`** so Pi records it under global `settings.json` → `packages`, and restarting is enough — the assets install themselves on first launch.

### 5. Decision packets are render-time, not stored

The blueprint had a separate `gaps` array and a separate decision queue. The shipping design derives both from the same underlying state: gaps are filtered from `verify.json` criteria; the decision queue is filtered from work item `decisions[]` where `status == pending`. No drift, no double-write.

### 6. Verification hook on post-code

The blueprint had verification as a *phase* that runs at end of pipeline. The shipping design also runs a lighter `verify-code` check after every `phase-code` (via a Pi `tool_use` hook), confirming that the structural commands declared in `## Dev Harness` (typecheck, lint, test) still pass before the agent's return value is accepted. A failing structural check rejects the agent's `done` claim.

This is the difference between "agent says it's done" and "agent says it's done *and* the structural gates agree". The acceptance verification phase still runs at the end — the post-code hook is the per-step safety net.

---

## What Got Cut, and Why

Honest list of things in the original blueprint that did not make it into the shipping design.

| Item | Status | Reason |
|---|---|---|
| RESPOND pattern (express path) | Cut | Bug-fix bursts don't benefit from a contract; the diff is the spec. Use a regular skill or just the `/commit` flow. |
| MIGRATE pattern | Cut | Codemod tools (jscodeshift, ast-grep) are better at the deterministic detection step than an agent harness. |
| THINKING PARTNER | Cut | No state to manage; the existing Pi conversation is the right surface. |
| Multi-repo orchestration | Deferred | One work item per repo for now. Cross-repo dependencies handled by sequencing PRs manually. |
| Orchestrated variant (parallel worktrees) | Deferred | Single-task pipeline shipping first. Worktree fan-out exists in `wt_*` tools but isn't wired into ACCORD. |
| Mutation testing inline (`Stryker`/`mutmut`) | Cut | Pushed to CI. Inline runs were too slow to fit between code-time gates. |
| `pre_impl_gates` resume logic | Cut | The blueprint's three-gate Step 3.5 was prototype-specific. Replaced by `phase-test` + `review-test` running before `phase-code`, with no intermediate gate state to resume from. |
| Cross-model review | Deferred | Worth the latency cost only on highest-risk changes. No mechanism in the harness yet — engineers can spawn a manual second review. |
| Property-based testing agent | Deferred | Hypothesis-style fuzzing is a future agent (`phase-property`?) once we have a corpus of `property`-typed ACs to test it on. |
| Planner/Challenger debate | Deferred | The current `review-plan` is single-pass. Multi-round debate is research-stage. |
| Schema version migration | Partial | `schema_version: "1.0"` is on every artifact and validated for presence; forward-migration of v1.0 → v1.1 artifacts is not implemented. |

---

## Open Questions

These are decisions the harness has not yet committed to. Each one will land somewhere on the principles → patterns → architecture stack as evidence accumulates.

1. **When does `phase-explore` win over reading the spec slice?** Both feed the same agent. Cheaper to inline relevant code into the brief; more thorough to spawn a dedicated explore phase. Heuristic TBD.
2. **How aggressive should `review-deviation` be?** Today every deviation surfaces in the decision queue. The risk is review fatigue; the reward is no silent drift. Need usage data.
3. **Should `phase-gaps` create tracker tickets directly, or just emit a list?** The original `dev-gaps` created Jira tickets. ACCORD currently only emits the gap list — the engineer decides what to do with it. Direct ticket creation re-introduces the "agent took an action I didn't see" failure mode.
4. **Where does the per-task file model fit in the single-pipeline variant?** The blueprint's `.tasks/PROJ-1234-task-{N}.json` exists to support concurrent worktrees. With sequential execution there's no contention; the per-task file collapses into the work item file. Worth keeping the split anyway as future-proofing?
5. **Auto-install opt-out scope.** Today the global config and env var control auto-install. Should there be a per-project flag too? Probably not — auto-install is a developer-machine concern, but worth re-checking once teams adopt the harness.

---

## Sources

ACCORD's research lineage. The items below are the ones that most directly shaped a shipping decision.

- **Anthropic — [Effective Context Engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)**: Drove the decision to isolate every phase in its own subagent process.
- **Anthropic — [Building Effective Agents](https://www.anthropic.com/engineering/building-effective-agents)**: Orchestrator-worker split, JSON state.
- **Martin Fowler — [Humans and Agents in SE Loops](https://martinfowler.com/articles/exploring-gen-ai/humans-and-agents.html)**: Two-gate model (approval + PR), batched review.
- **ThoughtWorks — [Spec-Driven Development](https://www.thoughtworks.com/en-us/insights/blog/agile-engineering-practices/spec-driven-development-unpacking-2025-new-engineering-practices)**: Spec-as-contract, immutability after approval.
- **ASDLC — [Adversarial Code Review](https://asdlc.io/patterns/adversarial-code-review/)**: Writer/reviewer separation, evidence-based findings.
- **Gloria Mark — [Cost of Interrupted Work](https://ics.uci.edu/~gmark/chi08-mark.pdf)**: 23-minute recovery cost. The number behind every "make this autonomous" decision.
- **Atlassian — [HULA paper](https://www.atlassian.com/blog/atlassian-engineering/hula-blog-autodev-paper-human-in-the-loop-software-development-agents)**: Human-in-the-loop framing, decision packet design.
- **Stripe — [Minions](https://stripe.dev/blog/minions-stripes-one-shot-end-to-end-coding-agents)**: One-shot agents as a counterpoint — what ACCORD chose *not* to build.
