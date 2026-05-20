# Event hooks and tools

The harness exposes two runtime extension surfaces: **event hooks** that fire on Pi lifecycle events, and **tools** that core logic exposes to agents (and to other MCP clients).

## Event hooks

Registered by `src/adapters/pi/hooks.ts`, which delegates behaviour to `src/core/harness/` so the same logic can be invoked from Cursor hook scripts or tests without Pi types.

### Schema validation (tool_result → write/edit)

Intercepts every `write` or `edit` to `.tasks/*.json` or `docs/dev/**/*.json`. Matches the filename against `SCHEMA_MAP` in `src/core/artifacts/validation.ts` to select the correct schema, validates, and returns an error if the shape is invalid. This is how the harness enforces artifact structure without agents needing to know about validation.

### Config auto-refresh (tool_result → write/edit to AGENTS.md)

When `AGENTS.md` is written, reloads the cached `devConfig` so subsequent hooks see the latest project configuration.

### Config guard + brief injection (tool_call → subagent)

Fires before every subagent spawn. Two responsibilities:

1. **Config guard** — agents registered with `requiresConfig: true` in `src/core/agents/registry.ts` are blocked if no `devConfig` exists. Agents with `deferConfigGuard: true` (like `phase-gather`) are exempt.
2. **Spawn payload** — mutates the outgoing `subagent` tool call in place (`src/core/subagent/`):
   - `agentFile` — absolute path to bundled phase/review agent markdown
   - `systemAppend` — `## Project Stack` from `devConfig` plus intent-contract brief when present
   - `response` — return-schema contract (pi-subagent appends schema text to the task)

### Gather preflight (tool_call → subagent phase-gather)

Before `phase-gather` runs, checks availability of configured sources (Jira, Slack, Confluence, Google Docs). Loads the bundled provider sidecars from `assets/providers/{trackers,enrichments}/*.json` and merges any user-defined providers from `accord.json`. Prompts the user to confirm if sources are unavailable. Injects a preflight report into the gather brief that includes a **Provider Playbooks** block with absolute paths to each active provider's markdown playbook, so user-supplied providers work without prompt edits.

### Subagent result processing (tool_result → subagent)

After any subagent completes:

1. **Usage tracking** — extracts `work_item_id` from the task text, appends a line to `<ID>-usage.jsonl` with token counts and cost, updates the work item's `cost_usd`.
2. **Return packet extraction** — prefers `parsedReturn` from programmatic `runSubagent`, else the last `\`\`\`json` block in the assistant message (`src/core/subagent/result/packet.ts`).
3. **Return packet validation** — validates the packet against the agent's return schema from `src/core/agents/registry.ts`.
4. **Post-code verification** — for agents with `verifyAfter: true` (currently `phase-code`), runs `type_check` and `test.command`. Type check failure is a hard gate (appended as error). Test failure is advisory.

### Verify preflight (tool_call → subagent phase-verify-*)

Before any verify agent runs:

1. **Staleness check** — confirms `spec.json` and `plan.json` exist at `docs/dev/<ID>/` and that `verify.json` (if it exists) isn't stale (spec/plan modified since last verify).
2. **Verification commands** — runs the full `verification_commands` array from config. Blocks if ALL commands fail. Injects results into the verify agent's brief.

### End-of-turn notification (agent_end)

Counts pending decisions across all work items. Notifies the user if any exist.

### Session start (session_start)

Loads `devConfig` from `AGENTS.md`. Discovers work items. Restores the status bar.

### Status bar

Displays: language, active work item ID + phase, pending decision count, cumulative cost. Updated after every subagent result and session start.

## Tools

All registered in `src/adapters/pi/tools.ts` as thin wrappers around core domain functions.

| Tool | Domain function | Purpose |
|------|----------------|---------|
| `dev_tasks` | `src/core/queries/dashboard.ts` | Work item dashboard with status, cost, pending decisions |
| `dev_bootstrap` | `src/core/work-items/lifecycle.ts` | Create new work item with correct schema and entry phase |
| `dev_checkpoint` | `src/core/work-items/checkpoint.ts` | Read/write/delete checkpoint for multi-turn phases |
| `dev_review_queue` | `src/core/queries/review-queue.ts` | Pending decisions + deviations across all work items |
| `dev_promote_events` | `src/core/work-items/lifecycle.ts` | Promote task events to work item (escalations → decisions, deviations → deviations) |
| `dev_spec_gaps` | `src/core/queries/spec-gaps.ts` | 10-point checklist against spec JSON |
| `dev_code_brief` | `src/core/briefing/code-brief.ts` | Assemble phase-code brief from spec + plan + task + brief |
| `dev_resume_state` | `src/core/queries/resume-state.ts` | Phase + checkpoint presence for dispatch routing |
| `dev_orchestrate` | `src/core/orchestration/runner.ts` | Deterministic **resume** or **finish** plan (`resolution` + `next_steps` JSON); MCP cannot spawn Pi subagents or run judgment LLM |
| `dev_transition` | `src/core/work-items/lifecycle.ts` | Atomic phase transition with artifact path updates + checkpoint cleanup |
| `dev_verify_summary` | `src/core/queries/verify-summary.ts` | Parse verify report, write verify.md, return verdict + per-AC counts + gaps |
| `dev_nonce` | `src/core/briefing/code-brief.ts` | 6-char hex nonce for task ownership |
| `dev_decision_packet` | `src/core/briefing/decision-packet.ts` | Format decision packet for user display |
| `dev_intent` | `src/core/commands/intent.ts` | Deterministic intent classification from free-text input |
| `dev_intent_enrich` | `src/core/commands/intent.ts` | Refine intent recommendation using ticket metadata signals |
| `dev_quick_fix_brief` | `src/core/briefing/code-brief.ts` | Create quick_fix task state, write spec/plan stubs, and assemble phase-test or phase-code brief |
| `dev_finalize` | `src/core/work-items/lifecycle.ts` | Persist terminal outcome, next action, retro, shift-left findings |
| `dev_retro` | `src/core/queries/retro.ts` | Analyse harness sessions for shift-left improvements |
| `dev_init_detect` | `src/core/config/init-detect.ts` | Detect project stack, infer commands, resolve config placement |
| `dev_init_write` | `src/core/config/init-write.ts` | Write detected config to AGENTS.md |

The same tool names and behaviour are exposed over **stdio MCP** for Cursor / other MCP clients: `src/adapters/mcp/server.ts` (registered in `src/adapters/mcp/register-tools.ts`). Run from this package:

```bash
ACCORD_CWD=/path/to/your/repo bun run mcp
```

`ACCORD_CWD` is optional; when set, the server `chdir`s there so `.tasks/` and `docs/dev/` resolve like the Pi extension. MCP does not run Pi event hooks (on-write schema validation, post-code verification, subagent brief injection)—add Cursor hooks or CI steps if you need that parity.

The **`dev_orchestrate`** tool (`command`: **`resume`** | **`finish`**) returns the same structured routing the core harness uses for `/dev resume` and `/dev finish` when `ACCORD_CORE_ORCHESTRATOR=1`: a `resolution` plus machine-readable `next_steps` (`spawn_subagent`, `notify_user`, `delegate_to_skill`, …). **finish** plans **phase-verify-acceptance** (it does not run `dev_verify_summary` / `dev_finalize` — those execute only after a successful Pi subagent spawn on the finish orchestration path). The payload marks `programmatic_spawn_supported: false` on stdio MCP; clients that need an isolated phase agent must spawn their own process or forward to the bundled accord skill. For **`resume`** spawns where judgment is configured in Dev Harness, the payload also includes `judgment_configured_for_spawn` and, when true, `spawn_task_after_template_judgment` — the same **template-only** task body the harness uses when `runJudgment` is absent or returns nothing parseable (headless parity with Pi when the judgment LLM is off or fails; it can still diverge from Pi when the model returns valid JSON).

**Orchestration judgment (Phase 5, Pi only):** when `orchestration.judgment.enabled` is true in the Dev Harness JSON **and** `ACCORD_ORCHESTRATION_JUDGMENT=1`, resume spawns for allowed dispatch agents (default `review-test`, `phase-test`) may call a **bounded** `completeSimple` completion; the model must return JSON matching `schemas/orchestration-judgment-packet.json`. Core validates and merges a supplement into the outbound task, or appends a **template** appendix when the model output is missing or invalid. MCP / stdio clients do not implement `runJudgment` — use `spawn_task_after_template_judgment` from `dev_orchestrate` for the deterministic template path, or configure judgment only for interactive Pi sessions with a configured model and API credentials.
