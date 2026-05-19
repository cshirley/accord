# Harness orchestration — implementation plan

This document turns [`harness-orchestration.md`](harness-orchestration.md) into an **executable** roadmap: ordered work, deliverables, acceptance criteria, and risk spikes. It is a living plan — update it as phases land.

---

## Goals (unchanged from design)

1. **Graph and transition policy** live in `src/core/` as declarative config + interpreter, with unit tests.
2. **Orchestrator** owns boundary validation and routing; **components** (agents, briefers) own domain validation.
3. **`src/adapters/pi`** implements **host ports only** (especially programmatic or equivalent `spawnSubagent`); no workflow graph in the adapter.
4. **`assets/skills/accord/SKILL.md`** shrinks to non-authoritative user hints for paths not yet covered by the runner (until fully retired for those flows).

---

## Phase 0 — Spikes (block or unblock design)

| Spike | Question | Done when |
|--------|-----------|-----------|
| **S0a — Pi programmatic subagent** | Can `ExtensionAPI` invoke the `subagent` tool (or an official equivalent) without a user turn? | **Resolved:** `ExtensionAPI` does not expose generic tool execution. The adapter calls `runSubagent()` from `packages/pi-subagent/src/api.ts` (same isolated `pi` child-process path as the `subagent` tool). |
| **S0b — Result path parity** | Does programmatic spawn still flow through `tool_call` / `tool_result` hooks so `processSubagentToolResult`, usage, and brief injection behave identically? | **Partial:** there are no synthetic Pi tool events. The adapter runs `prepareSubagentToolCall`, gather/verify preflight, spawn, then invokes `processSubagentToolResult` with Pi-shaped `details` so usage + return-packet handling align with the normal tool path. |
| **S0c — Parallel / chain** | How will the runner express `tasks: [...]` and `chain: [...]` payloads relative to today's `collectSubagentEntries`? | **Types landed** on `NextStep`; **Pi `/dev resume`:** `runResumeOrchestrationWithReplans` replans after each exit-0 subagent (cap 8, `Math.max(1, …)`), so quick_fix can run `phase-test` then `review-test` in one command when task state advances on disk. `spawn_chain` / `spawn_parallel` still unused by resume planner. |

**Exit:** go/no-go on "runner drives subagents from core" for Phase 2+. If no-go, Phase 1 still delivers value (graph + interpreter + tests) behind a feature flag with skill-only execution.

---

## Phase 1 — Core skeleton (no Pi behaviour change)

**Objective:** Land the **module boundary** and **typed graph** without changing user-visible `/dev` behaviour.

### Deliverables

1. **`src/core/orchestration/`** (exact name per team preference; keep stable once imported). **D1:** hand-rolled declarative graph + interpreter (no FSM library):
   - `host.ts` — `OrchestrationHost` interface: `spawnSubagent`, `notify`, `confirm` (minimal set); optional `runJudgment` stub behind flag.
   - `types.ts` — `OrchestrationContext`, `NextStep` union (`SpawnSubagent`, `RunTool`, `NotifyUser`, `StopForUser`, `DelegateToSkill` placeholder), `StopReason`, `SubagentSpawnRequest` (align with existing subagent payload shapes).
   - `graph.ts` — declarative nodes/edges + metadata (`agentId`, policy keys); `validateGraph(registry)` at module load or explicit `init`.
   - `guards.ts` — named pure predicates; registry map `string → fn`.
   - `interpreter.ts` — `resolveNextStep(ctx, event)`; no I/O.
   - `runner.ts` — skeleton `runUntilStop(ctx, host)` that **only** handles `NotifyUser` / `StopForUser` / no-op for spawns until Phase 2.

2. **Tests** (`*.test.ts` next to or under `tests/` per repo convention):
   - Graph validation: unknown `agentId`, unreachable nodes, missing edge handlers.
   - Interpreter: given fixture `WorkItem` + checkpoint + synthetic `SubagentCompleted` event → expected `NextStep`.
   - Golden fixtures copied from minimal `.tasks/*.json` + `docs/dev/*/…` snippets (redact noise).

3. **Exports** — `src/core/orchestration/index.ts` re-export surface for adapters.

### Acceptance criteria

- `bun test` includes new tests; no new dependency on Pi types inside `src/core/orchestration/`.
- `validateGraph` runs in CI (import side effect or explicit test).

### Out of scope

- Changing `extension.ts` forwarding (avoid dead code unless a compile-time smoke import is needed).

### Status (landed slice)

- **Module:** `src/core/orchestration/` — `types.ts` (`NextStep`, graph types, S0c chain/parallel spawn requests, `RunUntilStopResult`), `graph.ts` (`REFERENCE_ORCHESTRATION_GRAPH` + `validateOrchestrationGraph` with reachability + guard keys + resume agent registry checks), `guards.ts` (`always_true` / `always_false`), `interpreter.ts` (edge selection + `interpretResume` alias), `implement-resume.ts` (`resolveImplementResumeAgentId`), `implement-phase-code.ts`, `finish-resolve.ts`, `runner.ts` (`planDevResumeOrchestration`, `planDevFinishOrchestration`, `resumeResolutionToNextSteps`, `runUntilStop`, `runResumeOrchestrationWithReplans`, `runFinishOrchestration`, `runFinishOrchestrationFromResolution`, `buildDevOrchestratePayload`), `policy.ts` (quick-fix + implement loop defaults).
- **Tests:** graph/orphan validation, reference transitions, `runUntilStop` with fake host (`tests/orchestration.test.ts`).
- **MCP / Pi:** `dev_orchestrate` tool (parity list) returns resume orchestration JSON for headless clients (`docs/hooks-and-tools.md`).

---

## Phase 2 — Host port + pilot subcommand (`resume`)

**Objective:** One **user-visible** path proves the stack: `/dev resume <ID>` handled by **core runner** + **Pi host** + **one** subagent spawn (or explicit "nothing to do" notify).

### Deliverables

1. **`OrchestrationHost` Pi implementation** (new file under `src/adapters/pi/`, e.g. `orchestration-host.ts`):
   - Implements `spawnSubagent` per S0a outcome.
   - Maps `notify` / `confirm` to `ctx.ui` (same semantics as gather/verify preflight callers).

2. **`runDevOrchestration` (or equivalent) entry** in core:
   - Input: parsed route from `devDispatch`, `DevHarnessConfig | null`, work item id from args.
   - Output: structured `CommandOutcome` for the adapter: list of UI notifications, optional list of spawn results, `shouldForwardToSkill: boolean`.

3. **`extension.ts` integration**:
   - For `known` + `resume` + valid id only: call runner with Pi host; **do not** `sendUserMessage(/skill:accord)` on success path.
   - Preserve plan-mode and read-only behaviour; align `isReadOnlyDevRoute` with any new "local only" commands.

4. **Semantics** — match current skill expectations for resume:
   - Resolve phase via `devResumeState` / checkpoint rules already in core.
   - Spawn exactly the agent the graph names for that state (first milestone: single agent; expand later).

### Acceptance criteria

- Manual checklist: `/dev resume <ID>` with a fixture work item spawns the same agent name as today's playbook for that state (document comparison in PR).
- Hooks still record usage for that subagent call (S0b).
- Failure modes (missing WI, missing config when required) surface as `notify` messages, not silent no-op.

### Rollback

- Revert `extension.ts` branch that routes `resume` through the runner; forward to skill again if blocker.

### Status (landed slice)

- **Env flag:** set `ACCORD_CORE_ORCHESTRATOR=1` to enable the core **resume** and **finish** paths (default remains skill-forwarding).
- **Resume:** when the effective phase resolves to a registered agent id, `/dev resume <ID>` runs that subagent via `runSubagent()` without `/skill:accord`. **Coarse WI phases** map in core (`phase-coarse-routing.ts`): `aligning`→`phase-align`, `speccing`→`phase-spec`, `planning`→`phase-plan`, `gathering`→`phase-gather`, `exploring`→`phase-explore`; `researching`→`phase-gather` **only** for pattern `analyse`. **`implement` + `implementing`:** primary task file `phase` → harness agent when in `RESUMABLE_PIPELINE_TASK_PHASES` (`implement-resume.ts`); otherwise forward. **`quick_fix` + `fixing`:** same per-task phases via `quick-fix.ts`. Other coarse values still **forward** to the accord skill. Agents that `requiresConfig` block when no dev harness config is loaded.
- **Finish:** `/dev finish <ID>` (same flag) surfaces **review queue** + **tasks**, then runs `runFinishOrchestrationFromResolution` → **phase-verify-acceptance**; on exit 0 runs **dev_verify_summary** + **dev_finalize** (`finish-orchestration.ts`).
- **Adapter files:** `resume-orchestration.ts` drives `runResumeOrchestrationWithReplans` → `runUntilStop` (per iteration) with `createResumeOrchestrationRuntimeHost` (`orchestration-runtime-host.ts`: preflight + `runSubagent()` + `processSubagentToolResult`). Replans after each successful spawn until a non-spawn outcome, duplicate spawn fingerprint, subagent failure, or sequential cap.
- **Core module:** `src/core/orchestration/*` — `resume-resolve`, `finish-resolve`, `runner` (`planDevResumeOrchestration`, `planDevFinishOrchestration`, `buildDevOrchestratePayload`, `runFinishOrchestration*`), `graph`/`interpreter`/`policy`, types, env flag.

---

## Phase 3 — Expand deterministic subgraphs

**Objective:** Move **multi-step deterministic** sequences from the skill into the runner **without** giving the main model `subagent` choice.

### Suggested order (each is a vertical slice + tests)

1. **Finish closeout tool chain** — steps that are already mostly `dev_*` tools and file updates; minimal LLM.
2. **Quick-fix path** — `new_red_test`: `phase-test` → `review-test` → policy branch → `phase-code` with counters persisted on task file (reuse existing fields; extend only if necessary).
3. **Standard implement test loop** — same as above within full pipeline constraints (respect `challenge`, `request_review` flags via **policy**, not model).
4. **Gather delegation** — when graph says `phase-gather`, runner spawns it; gather preflight remains in hooks.

### Deliverables per slice

- Graph nodes/edges + guard + **policy module** (`policy.ts`: max respawns, severity enums; **D2:** persist loop counters on the **task file**).
- Fixture tests for each branch (respawn, proceed-with-warning, blocked).
- (**D3 — big-bang:**) Do **not** trim `assets/skills/accord/SKILL.md` orchestration per slice. Track behavioural parity in tests and this doc; remove conflicting skill prose in **Phase 7** as one coordinated edit once the runner owns all targeted flows.

### Acceptance criteria

- No duplicate conflicting instructions between skill and core for covered flows.
- Schema validation on return packets before policy runs (reuse `src/core/artifacts/` validation where applicable).

### Status (Phase 3 — landed)

1. **Finish closeout** — `finish-resolve.ts` + `runFinishOrchestration` / `runFinishOrchestrationFromResolution`: `/dev finish` (flagged) surfaces **review queue** + **tasks**, spawns **phase-verify-acceptance**, then **dev_verify_summary** + **dev_finalize** on exit 0; `dev_orchestrate` supports `command: "finish"`.
2. **Quick-fix path** — loop counters, severity gate, `phase-test` → `review-test` for quick_fix and implement, resume replans.
3. **Standard implement test loop** — `RESUMABLE_PIPELINE_TASK_PHASES` includes **`review-code`**; `implement-phase-code.ts` + `orchestration.implement_loop` policy after validated **phase-code** when plan `challenge` or packet `reviews_requested` > 0; `task-schema` phase enum extended.
4. **Gather delegation** — coarse **`gathering` → phase-gather`** on `/dev resume`; gather preflight unchanged in hooks. `REFERENCE_ORCHESTRATION_GRAPH` stays the Phase 1 validation fixture (S0c chain/parallel reserved).

---

## Phase 4 — Subcommand coverage + classify / bootstrap

**Objective:** Reduce `/skill:accord` forwarding to **edge cases** only.

### Deliverables

1. Map each `DEV_SUBCOMMANDS` entry to `{ runner | skill-fallback }`.
2. **Free text / classify** path:
   - Runner calls existing `recommendIntentMode` / bootstrap (`dev_bootstrap`) deterministically where possible.
   - Optional: one bounded LLM step only if product requires it — behind host `runJudgment` with strict schema; default off.

3. **`devDispatch` extensions** if the runner needs richer parsing than raw `args` string (keep parsing in `src/core/commands/`).

### Acceptance criteria

- Table in this doc (or `harness-orchestration.md`) listing subcommand → owner.
- Autocomplete / help still accurate (`help.ts`, `dispatch.ts`).

### Status (Phase 4 — landed)

1. **Routing table** — `src/core/commands/subcommand-routing.ts` maps every `DEV_SUBCOMMANDS` entry to `extension_local`, `core_orchestrator_when_flagged`, or `skill` (`assertSubcommandRoutingComplete` enforces parity with `DEV_SUBCOMMANDS`). `isPlanModeReadOnlyDevSubcommand` centralises Pi plan-mode allowlist (`help`, `tasks`, `retro`).
2. **Classify / free text** — `src/core/commands/classify-dispatch.ts` (`classifyPreflight`): runs `recommendIntentMode` (same rules as `dev_intent`); optional deterministic `dev_bootstrap` when input is `TICKET title…`, `needs_confirmation` is false, intent supports a persisted pattern, and the work item id is not already present. Pi `extension.ts` notifies intent (and bootstrap outcome) before `/skill:accord` follow-up.
3. **`devDispatch` extension** — `parseKnownDevSubcommandArgs` + `DEV_WORK_ITEM_ID_PATTERN` in `dispatch.ts` for structured tails (flags vs leading work item id).
4. **Help** — `help.ts` documents local vs flagged orchestrator vs skill vs free-text routing.
5. **Tests** — `tests/core-contracts.test.ts` covers `parseKnownDevSubcommandArgs`, routing completeness, and `classifyPreflight` bootstrap / skip paths.

Phase 3 quick-fix / implement-loop bullets remain in the Phase 3 section above; they are not duplicated here.

### Subcommand → owner (living)

| Subcommand | Owner | Notes |
| --- | --- | --- |
| `<free text>` | Core preflight → skill | `classifyPreflight` (`recommendIntentMode` + optional ticket `dev_bootstrap`); then `/skill:accord` |
| `help`, `tasks`, `retro`, `tag` | **extension** (local) | `extension.ts` — no skill |
| `resume`, `finish` | **core orchestrator** (flagged) | `ACCORD_CORE_ORCHESTRATOR=1` → runner + runtime host; else skill |
| `init`, `align`, `spec`, `plan`, `check`, `gaps`, `review`, `deviations`, `amend-spec`, `spec-gaps` | **skill** | `/skill:accord` |

---

## Phase 5 — Judgment hook (optional product layer)

**Objective:** LLM assists **brief composition** or similar; **never** selects `agent` string.

### Deliverables

- JSON schema for judgment output; validate in runner before merge.
- Host `runJudgment` implementation on Pi (and noop on MCP until defined).

### Acceptance criteria

- Fuzz tests: invalid judgment JSON → deterministic fallback (template-only brief appendix).

### Status (Phase 5 — landed)

1. **Schema** — `schemas/orchestration-judgment-packet.json` (`schema_version`, `brief_appendix`, optional `focus_points`). No routing fields.
2. **Core** — `src/core/orchestration/judgment.ts` (`validateOrchestrationJudgmentPacket`, `mergeResumeTaskWithJudgment`, `extractJsonObjectFromModelText`, `isOrchestrationJudgmentConfigured`). `runResumeOrchestrationWithReplans` merges judgment **after** plan fingerprinting (fingerprint uses pre-judgment task) and **before** spawn.
3. **Pi host** — `createResumeOrchestrationRuntimeHost` implements `runJudgment` via `@earendil-works/pi-ai` `completeSimple` when `ACCORD_ORCHESTRATION_JUDGMENT=1` **and** `orchestration.judgment.enabled` in Dev Harness JSON; otherwise returns `undefined` (core applies template appendix when judgment is configured, or skips merge when not configured).
4. **Config** — `orchestration.judgment` in `schemas/accord-schema.json` + `DevHarnessOrchestrationConfig` (`enabled`, optional `agents`, optional `max_tokens`).
5. **Tests** — `tests/orchestration-judgment.test.ts` (validation, merge, oversized appendix, random-input fuzz → template).

---

## Phase 6 — MCP and non-Pi consumers

**Objective:** Clear contract for MCP without lying about capabilities.

### Options (pick one in an ADR-style note)

- **A.** New MCP tool `dev_orchestrate` / `dev_step` returning `NextStep` + instructions when spawn unsupported.
- **B.** Document MCP as tool-granular only until a headless host exists.

### Acceptance criteria

- `docs/hooks-and-tools.md` updated with MCP story.
- If A: MCP tests or smoke script extended.

### Status (landed slice)

- **Option A (partial):** `dev_orchestrate` with `command: "resume"` | `"finish"` returns `{ resolution, next_steps, programmatic_spawn_supported, judgment_configured_for_spawn, spawn_task_after_template_judgment? }` JSON on both Pi tools and MCP (registered from `src/core/tools/registry.ts`). Stdio MCP remains spawnless and judgment-LLM-less; clients interpret `next_steps` locally and use `spawn_task_after_template_judgment` when present for resume/judgment template parity.
- **Contract test:** `tests/dev-orchestrate-payload-contract.test.ts` asserts the stable payload shape (Phase 6 acceptance — MCP tests extended).

---

## Phase 7 — Cleanup and guardrails

1. **Skill minimisation (D3)** — **Single** coordinated reduction of `SKILL.md` orchestration so it no longer contradicts core; ship alongside the cutover that enables the runner for all covered subcommands (feature flag off by default until then). Re-run `validate:assets` / manifest checks after skill edits.
2. **Telemetry / retro** — harness-run markers and insights still correlate; add test or doc note.
3. **Remove dead code** — unused skill sections, duplicate tool prompt snippets on Pi if runner subsumes them.
4. **Performance** — sequential spawns: document expected latency vs old single-turn skill.

### Status (partial — telemetry / retro)

- **`dev_retro` + `dev-harness-run`:** `tests/dev-retro-harness-marker.test.ts` locks in that a Pi session JSONL line with `customType: "dev-harness-run"` yields `associated_by: "marker"` (no reliance on the legacy `/dev` / `.tasks/` text heuristic when `include_legacy_heuristic: false`).
- **Core orchestrator parity:** flagged `/dev resume` still flows through `processSubagentToolResult` and `ensureAutoHarnessRunMeta` like skill-driven subagents; `syncHarnessRunSessionEntry` (`hook-state.ts`) still appends the same transcript marker when run id/tag exist.

### Status (partial — skill / docs, not full D3 cutover)

- **`assets/skills/accord/SKILL.md`** — Added §**Extension vs this skill (routing)** (orchestrator flag, local subcommands, `dev_orchestrate`), **`dev_orchestrate`** in the tools table, corrected **help** sourcing (`help.ts` / `DEV_HELP_TEXT`), and clarified **finish** + **spawn** rows when the extension runs programmatic spawns.
- **D3 prose slice (done in this branch):** Removed the long **Quick fix loop** / **Code loop** duplicate (and a corrupted thrift truncation line). Replaced the tail with **§Multi-turn checkpoints**, a slimmer **phase→agent** table, **policy source of truth** (`orchestration.quick_fix_loop` default 5 + `implement_loop`, no hardcoded “max 2 respawns”), condensed **per-task** steps, and short **align/spec/plan**, **resume**, **finish**, and **check/gaps/…** sections that defer detail to agents + `resume-resolve.ts`.
- **D3 follow-up slice:** Collapsed **Runtime architecture** (pointer to `docs/hooks-and-tools.md`), **Orchestrator tools** (ordered list + parity test pointer, no per-row table), **init** (numbered flow + `init-detect` / `init-write` / `configuration.md`), and **default dispatch** (intent/bootstrap pointers to `intent.ts`, `lifecycle.ts`, `classify-dispatch.ts` + retained pattern/entry tables). **Still partial for “full D3”** if we later want the skill to be *only* routing glue with zero step lists — that would require core-owned copy or accepting thinner operator UX in the skill.

### Status (partial — performance note)

- **Sequential replans:** each `/dev resume` spawn under `ACCORD_CORE_ORCHESTRATOR=1` is a separate isolated `pi` child process (same as the `subagent` tool). Chaining `phase-test` → `review-test` in one user command can cost **multiple cold starts** versus a single skill turn that only describes the chain in chat — acceptable trade-off for deterministic routing and identical hooks/usage.

---

## Cross-cutting practices

| Practice | Application |
|-----------|-------------|
| **Feature flag** | `ACCORD_CORE_ORCHESTRATOR=1` enables the core `/dev resume` and `/dev finish` orchestration paths; unset or any other value keeps skill forwarding for those subcommands. |
| **PR size** | Prefer small PRs for **core and adapter code** (one subgraph or subsystem at a time). **D3:** skill orchestration removal stays **one** Phase 7 PR, not dribbled per subcommand. |
| **Docs** | Update [`pipeline.md`](pipeline.md) diagrams with "harness runner" swimlane when behaviour changes. |
| **Biome / check** | Full `npm run check` before merge. |

---

## Dependency graph (summary)

```
Phase 0 spikes
    → Phase 1 (core skeleton + tests)
        → Phase 2 (resume pilot + Pi host)
            → Phase 3 (subgraphs)
                → Phase 4 (full subcommands + classify)
                    → Phase 5 (judgment hook, optional)
                        → Phase 6 (MCP)
                            → Phase 7 (cleanup)
```

Phases 3–4 can split into parallel streams **after** Phase 2 proves the host port.

---

## Architecture decisions (recorded)

| ID | Decision | Chosen option | Notes |
|----|-----------|---------------|--------|
| **D1** | Graph notation | **Hand-rolled TypeScript** | Declarative config + small interpreter in `src/core/orchestration/`; no third-party FSM library. Keeps dependency surface minimal and matches repo style. |
| **D2** | Where retry counters live | **Task file** (e.g. per-task JSON under `.tasks/`) | Loop caps and pre-impl gate state for test/review adversary flows stay on the task artifact; work item JSON stays high-level. Align new fields with existing task shape where possible. |
| **D3** | Skill removal aggressiveness | **Big-bang** | Do not run a long period of per-subcommand skill slimming for orchestration prose. Ship the core runner + Pi host for **all** covered flows in one coordinated cutover, then strip `assets/skills/accord/SKILL.md` orchestration in the same release window. **Implication:** Phases 1–3 can still land incrementally in development, but **production-facing** merge strategy should gate on full subgraph coverage + `npm run check` + manual smoke so the skill is not left contradicting core after partial merges. |

Further options remain open on other topics; add new rows (D4, …) as they arise.

---

## Related documentation

- [`harness-orchestration.md`](harness-orchestration.md) — design rationale and patterns.
- [`pipeline.md`](pipeline.md) — current runtime diagrams.
- [`hooks-and-tools.md`](hooks-and-tools.md) — hook surfaces and tools.
