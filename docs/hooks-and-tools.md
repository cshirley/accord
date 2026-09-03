# Event hooks and tools

The harness exposes two runtime extension surfaces: **event hooks** that fire on Pi lifecycle events, and **tools** that core logic exposes to agents (and to other MCP clients).

## Event hooks

Registered by `packages/pi-accord/src/adapters/pi/pi-hook-listeners.ts`, which delegates behaviour to `packages/accord-core/src/harness/` so the same logic can be invoked from Cursor hook scripts or tests without Pi types.

### Schema validation (tool_result → write/edit)

Intercepts every `write` or `edit` to `.tasks/*.json` or `docs/dev/**/*.json`. Matches the filename against `SCHEMA_MAP` in `packages/accord-core/src/artifacts/validation.ts` to select the correct schema, validates, and returns an error if the shape is invalid. This is how the harness enforces artifact structure without agents needing to know about validation.

### Config auto-refresh (tool_result → write/edit to AGENTS.md)

When `AGENTS.md` is written, reloads the cached `devConfig` so subsequent hooks see the latest project configuration.

### Config guard + brief injection (tool_call → subagent)

Fires before every subagent spawn. Two responsibilities:

1. **Config guard** — agents registered with `requiresConfig: true` in `packages/accord-core/src/agents/registry.ts` are blocked if no `devConfig` exists. Agents with `deferConfigGuard: true` (like `phase-gather`) are exempt.
2. **Spawn payload** — mutates the outgoing `subagent` tool call in place (`packages/accord-core/src/subagent/`):
   - `agentFile` — absolute path to bundled phase/review agent markdown
   - `systemAppend` — `## Project Stack` from `devConfig` plus intent-contract brief when present
   - `response` — return-schema contract (pi-subagent appends schema text to the task)

### Gather preflight (tool_call → subagent phase-gather)

Before `phase-gather` runs, checks availability of configured sources (Jira, Slack, Confluence, Google Docs). Loads the bundled provider sidecars from `packages/accord-assets/providers/{trackers,enrichments}/*.json` and merges any user-defined providers from `accord.json`. Prompts the user to confirm if sources are unavailable. Injects a preflight report into the gather brief that includes a **Provider Playbooks** block with absolute paths to each active provider's markdown playbook, so user-supplied providers work without prompt edits.

### Subagent result processing (tool_result → subagent)

After any subagent completes:

1. **Usage tracking** — extracts `work_item_id` from the task text, appends a line to `<ID>-usage.jsonl` with token counts and cost, updates the work item's `cost_usd`.
2. **Return packet extraction** — prefers `parsedReturn` from programmatic `runSubagent`, else the last `\`\`\`json` block in the assistant message (`packages/accord-core/src/subagent/result/packet.ts`).
3. **Return packet validation** — validates the packet against the agent's return schema from `packages/accord-core/src/agents/registry.ts`.
4. **Post-code verification** — for agents with `verifyAfter: true` (currently `phase-code`), runs `type_check` and `test.command`. Type check failure is a hard gate (appended as error). Test failure is advisory.

### Verify preflight (tool_call → subagent phase-verify-*)

Before any verify agent runs:

1. **Staleness check** — confirms `spec.json` and `plan.json` exist at `docs/dev/<ID>/` and that `verify.json` (if it exists) isn't stale (spec/plan modified since last verify).
2. **Verification commands** — runs the full `verification_commands` array from config. Blocks if ALL commands fail. Injects results into the verify agent's brief.

### End-of-turn notification (agent_settled)

After the agent loop fully settles (auto-retry, compaction, and queued continuations finished — not on bare `agent_end`), counts pending decisions across all work items and notifies the user if any exist.

### Session start (session_start)

- Loads `devConfig` from `AGENTS.md`, clears harness run tag state, seeds cost cache, and syncs the `dev-harness-run` session entry.
- **Dynamic tools (default on):** applies `setActiveTools` with the core `dev_*` set; expands phase bundles on `/dev` subcommands, bootstrap, and orchestration dispatch. Set `ACCORD_DYNAMIC_TOOLS=0` to keep every registered `dev_*` tool active (MCP stdio always exposes the full registry).
- Restores the status bar.

### Provider correlation headers (before_provider_headers)

When harness run metadata or an active work item is known, injects `X-Accord-Run-Id`, `X-Accord-Session-Tag`, and `X-Accord-Work-Item-Id` on outgoing provider requests for traceability.

### Session entry renderers (registerEntryRenderer)

Display-only markers appended via `appendEntry` (not in LLM context):

| `customType` | Renderer |
|--------------|----------|
| `dev-harness-run` | Run tag, run_id, work item ids, auto-provisioned flag |
| `thrift-output-level` | Current output compression level |
| `pi-worktree` | Branch/path summary |

Orchestrator subagent spawns still use `registerMessageRenderer` for live progress rows.

### Built-in tool render overrides

`read`, `write`, and `edit` are re-registered with harness-aware `renderCall` (paths under `.tasks/` or `docs/dev/` are highlighted). Execution delegates to Pi's built-in tool factories — only the TUI call row changes.

### Status bar

Displays: language, active work item ID + phase, pending decision count, cumulative cost. Updated after every subagent result and session start.

## Tools

All registered in `packages/pi-accord/src/adapters/pi/tools.ts` as thin wrappers around core domain functions. Core harness tools may include `promptSnippet` (Available tools section) and `promptGuidelines` (Guidelines bullets while active) when dynamic activation exposes them.

### Dynamic activation (Pi only)

| Set | Tools |
|-----|-------|
| **Core (always)** | `dev_intent`, `dev_intent_enrich`, `dev_bootstrap`, `dev_resume_state`, `dev_work_item_status`, `dev_tasks`, `subagent` |
| **spec** | checkpoint, spec_gaps, transition, finalize, subagent_preflight |
| **plan** | checkpoint, transition, subagent_preflight |
| **code** | code_brief, nonce, quick_fix_brief, verify_summary, promote_events, decision_packet, subagent_preflight |
| **init** | init_detect, init_write |
| **meta** | retro, review_queue, workflow_cost, orchestrate, rehydrate |

Bundles activate on `/dev` subcommands, bootstrap success, orchestration dispatch, and as a fallback when the model calls an inactive `dev_*` tool. See `packages/accord-core/src/tools/active-set.ts`.

| Tool | Domain function | Purpose |
|------|----------------|---------|
| `dev_tasks` | `packages/accord-core/src/queries/dashboard.ts` | Work item dashboard with status, cost, pending decisions |
| `dev_bootstrap` | `packages/accord-core/src/work-items/lifecycle.ts` | Create new work item with correct schema and entry phase |
| `dev_checkpoint` | `packages/accord-core/src/work-items/checkpoint.ts` | Read/write/delete checkpoint for multi-turn phases |
| `dev_review_queue` | `packages/accord-core/src/queries/review-queue.ts` | Pending decisions + deviations across all work items |
| `dev_promote_events` | `packages/accord-core/src/work-items/lifecycle.ts` | Promote task events to work item (escalations → decisions, deviations → deviations) |
| `dev_spec_gaps` | `packages/accord-core/src/queries/spec-gaps.ts` | 10-point checklist against spec JSON |
| `dev_code_brief` | `packages/accord-core/src/briefing/code-brief.ts` | Assemble phase-code brief from spec + plan + task + brief |
| `dev_resume_state` | `packages/accord-core/src/queries/resume-state.ts` | Phase + checkpoint presence for dispatch routing |
| `dev_work_item_status` | `packages/accord-core/src/queries/work-item-status.ts` | Single work item: tasks, next resume agent, `/dev finish` nudge; rehydrates + reconciles coarse phase |
| `dev_subagent_preflight` | `packages/accord-core/src/queries/subagent-preflight.ts` | Credentials, profile, agent file, spawn timeout before phase spawns |
| `dev_orchestrate` | `packages/accord-core/src/orchestration/plan.ts` | **resume** / **finish** plan (`resolution` + `next_steps`); same JSON as `accord plan --json`. Executes when MCP sets `ACCORD_MCP_HARNESS=pi|exec` (optional `execute: false` for plan-only). |
| `dev_transition` | `packages/accord-core/src/work-items/lifecycle.ts` | Atomic phase transition with artifact path updates + checkpoint cleanup |
| `dev_verify_summary` | `packages/accord-core/src/queries/verify-summary.ts` | Parse verify report, write verify.md, return verdict + per-AC counts + gaps |
| `dev_nonce` | `packages/accord-core/src/briefing/code-brief.ts` | 6-char hex nonce for task ownership |
| `dev_decision_packet` | `packages/accord-core/src/briefing/decision-packet.ts` | Format decision packet for user display |
| `dev_intent` | `packages/accord-core/src/commands/intent.ts` | Deterministic intent classification from free-text input |
| `dev_intent_enrich` | `packages/accord-core/src/commands/intent.ts` | Refine intent recommendation using ticket metadata signals |
| `dev_quick_fix_brief` | `packages/accord-core/src/briefing/code-brief.ts` | Create quick_fix task state, write spec/plan stubs, and assemble phase-test or phase-code brief |
| `dev_rehydrate` | `packages/accord-core/src/work-items/rehydrate.ts` | Recreate `.tasks/<ID>.json` (and task files) from `docs/dev/<ID>/` when runtime state was lost |
| `dev_workflow_cost` | `packages/accord-core/src/queries/workflow-cost.ts` | Token and estimated USD cost rollup from `.tasks/<ID>-usage.jsonl` |
| `dev_finalize` | `packages/accord-core/src/work-items/lifecycle.ts` | Persist terminal outcome, next action, retro, shift-left findings |
| `dev_retro` | `packages/accord-core/src/queries/retro.ts` | Analyse harness sessions for shift-left improvements (enriched via `SessionManager` / RPC `get_entries` parity) |
| `dev_init_detect` | `packages/accord-core/src/config/init-detect.ts` | Detect project stack, infer commands, resolve config placement |
| `dev_init_write` | `packages/accord-core/src/config/init-write.ts` | Write detected config to AGENTS.md |

The same tool names and behaviour are exposed over **stdio MCP** for Cursor / other MCP clients: `packages/pi-accord/src/adapters/mcp/server.ts` (registered in `packages/pi-accord/src/adapters/mcp/register-tools.ts`). Run from this package:

```bash
ACCORD_CWD=/path/to/your/repo bun run mcp
# Optional: run resume/finish spawns from MCP (not just plan JSON)
ACCORD_MCP_HARNESS=pi ACCORD_CWD=/path/to/your/repo bun run mcp
```

| Env | Effect |
|-----|--------|
| `ACCORD_CWD` | Project root (`.tasks/`, `docs/dev/`) |
| `ACCORD_MCP_HARNESS=pi\|exec` | `dev_orchestrate` executes via `accord-cli` harness (`programmatic_spawn_supported: true`) |

`ACCORD_CWD` is optional; when set, the server `chdir`s there so `.tasks/` and `docs/dev/` resolve like the Pi extension. MCP does not run Pi event hooks (on-write schema validation, post-code verification, subagent brief injection)—add Cursor hooks or CI steps if you need that parity.

The **`dev_orchestrate`** tool (`command`: **`resume`** | **`finish`**, optional **`execute`**: boolean) returns enriched routing JSON: `resolution`, `next_steps`, `programmatic_spawn_supported`, optional `harness`, and `execution` when the host ran the loop. **finish** plans **phase-verify-acceptance** (it does not run `dev_verify_summary` / `dev_finalize` — those execute only after a successful subagent spawn on the finish orchestration path). Without `ACCORD_MCP_HARNESS`, MCP is plan-only (`programmatic_spawn_supported: false`); use `accord resume <ID>` or set the harness env. For **`resume`** spawns where judgment is configured in Dev Harness, the payload also includes `judgment_configured_for_spawn` and, when true, `spawn_task_after_template_judgment` — template-only merge when `runJudgment` is absent.

**Orchestration judgment (Phase 5, Pi only):** when `orchestration.judgment.enabled` is true in the Dev Harness JSON **and** `ACCORD_ORCHESTRATION_JUDGMENT=1`, resume spawns for allowed dispatch agents (default `review-test`, `phase-test`) may call a **bounded** `completeSimple` completion; the model must return JSON matching `packages/accord-core/schemas/orchestration-judgment-packet.json`. Core validates and merges a supplement into the outbound task, or appends a **template** appendix when the model output is missing or invalid. MCP / stdio clients do not implement `runJudgment` — use `spawn_task_after_template_judgment` from `dev_orchestrate` for the deterministic template path, or configure judgment only for interactive Pi sessions with a configured model and API credentials.
