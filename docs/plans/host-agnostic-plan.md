# Host-agnostic ACCORD — implementation plan

This document turns the host-agnostic roadmap into an **executable** plan: decouple `accord-cli`, MCP, and agent runtimes from Pi while keeping `accord-core` as the single workflow brain.

**Related:** [`accord-cli-extraction.md`](accord-cli-extraction.md) (extraction complete), [`harness-orchestration.md`](../harness-orchestration.md) (orchestration design), [`accord-cli.md`](../accord-cli.md) (CLI reference), [`hooks-and-tools.md`](../hooks-and-tools.md) (hook surfaces).

---

## Goals

1. **Same delivery loop everywhere** — orchestration, artifacts, `dev_*` tools, and verification logic stay in `accord-core`.
2. **Pi is optional** — headless `accord`, MCP, and CI run without `@earendil-works/pi-coding-agent` or `pi-accord`.
3. **Swappable agent runtime** — `exec` harness is the default path; `pi` harness is opt-in; future backends plug in via registry.
4. **Hook parity contract** — non-Pi hosts can wire the same harness callables Pi gets from lifecycle hooks.
5. **No regression for Pi users** — `/dev` behaviour unchanged during deprecation windows.

---

## Current state (baseline)

| Area | Today |
|------|--------|
| **Orchestration** | Host-neutral in `accord-core` ✅ |
| **`accord-cli`** | Headless loop ✅; **hard-depends on `pi-accord`**; default harness **`pi`** ⚠️ |
| **MCP** | Lives under `pi-accord/adapters/mcp` ⚠️ |
| **Agent spawn** | `pi` → `pi-subagent` child process; `exec` → subprocess template ✅ |
| **Global config** | `~/.config/pi/agent/accord.json` ⚠️ |
| **Asset install** | Symlinks into `~/.config/pi/agent` ⚠️ |
| **Skills** | `commit`, `pr`, `review` in `pi-accord/assets` ⚠️ |
| **Judgment LLM** | `runJudgment` on Pi host only; MCP/CLI get template fallback ⚠️ |
| **MCP hooks** | No on-write validation, post-code verify, or brief injection unless client wires harness ⚠️ |
| **CLI parity** | Missing `retro`, `tag`, `rehydrate`, `spec-gaps`, `gaps` ⚠️ |
| **CI** | `pi-accord-ci` is Pi/subagent-centric ⚠️ |

**Invariant (must hold):** `accord-core` never imports Pi types or packages.

---

## Target architecture

```
accord-core          Workflow brain (orchestration, artifacts, harness callables)
accord-cli           Headless entry + harness registry (no hard Pi dep)
accord-mcp           Stdio MCP server (extracted from pi-accord)
pi-accord            Pi-only: /dev UI, hooks, TUI, Pi asset bootstrap
<host>-accord        Optional per-host adapters (cursor-accord, etc.)
harness backends     exec (default) | pi (opt-in) | plugins
```

### Dependency target (end state)

```
accord-core        → zero host deps
accord-cli         → accord-core, accord-assets
accord-mcp         → accord-core, accord-cli
pi-accord          → accord-cli, accord-core, pi-coding-agent (optional product)
pi-accord-ci       → accord-cli (exec path) OR pi-accord (legacy Pi path)
```

---

## Architecture decisions (recorded)

| ID | Decision | Chosen option | Notes |
|----|-----------|---------------|--------|
| **A1** | Global config path | **`~/.config/accord/accord.json`** | Read `~/.config/pi/agent/accord.json` as deprecated fallback; warn once |
| **A2** | Default harness | **`exec` when configured**; else explicit error with setup hint | `pi` via `--harness pi` or env; deprecation: auto-detect Pi install → default `pi` for one release |
| **A3** | MCP package | **`accord-mcp`** extracted from `pi-accord` | `pi-accord` may thin-reexport for backward compat |
| **A4** | Hook parity | **`HarnessHost` port** in core + reference Cursor hook scripts | Pi maps lifecycle events; MCP documents minimum hook set |
| **A5** | Judgment LLM | **Core provider port** | Pi is one implementation; CLI/MCP use OpenAI-compatible HTTP or optional `pi-ai` peer |
| **A6** | Skills | **Host-neutral playbooks** in `accord-assets` or `accord-skills` | Pi SKILL.md wrappers remain thin |

Add rows (A7, …) as new decisions arise.

---

## Phase 0 — ADRs and acceptance criteria

**Objective:** Lock decisions before code churn.

### Deliverables

1. This document (living plan).
2. Cross-link from [`accord-cli-extraction.md`](accord-cli-extraction.md) and [`concepts.md`](../concepts.md).
3. Per-phase acceptance tests listed below (implemented in later phases).

### Acceptance criteria

- Team agrees on A1–A6.
- No code changes required in Phase 0.

### Status

- [x] Plan document committed (`docs/plans/host-agnostic-plan.md`).

---

## Phase 1 — Decouple `accord-cli` from Pi

**Objective:** `accord-cli` installs and runs without `pi-accord` when using `--harness exec`.

### 1a — Optional Pi harness

| Change | Detail |
|--------|--------|
| Remove hard dep | Drop `@clive.shirley/pi-accord` from `accord-cli` `dependencies` |
| Optional / peer | `optionalDependencies` or `peerDependencies` on `pi-accord` |
| Dynamic load | `createHarness("pi")` → `require()` with clear error if package missing |
| Default harness | Read `harness.default` from config; env `ACCORD_HARNESS`; fallback per A2 |

**Files:** `packages/accord-cli/package.json`, `src/harnesses/registry.ts`, tests.

### 1b — Host-neutral config paths

| Change | Detail |
|--------|--------|
| `ACCORD_CONFIG_DIR` | Default `~/.config/accord` |
| `GLOBAL_CONFIG_PATH` | `$ACCORD_CONFIG_DIR/accord.json` |
| Fallback | Read legacy `~/.config/pi/agent/accord.json`; `notify` deprecation once |
| Template | Update `defaultGlobalConfigTemplate()` — host-neutral prose |

**Files:** `packages/accord-core/src/config/paths.ts`, `global.ts`, `accord-schema.json`, [`configuration.md`](../configuration.md).

### 1c — CLI command parity (`extension_local` → CLI)

| Command | Core entry |
|---------|------------|
| `accord retro` | `queries/session-transcript` + harness marker |
| `accord tag` | work-item tag mutation |
| `accord rehydrate` | `work-items/rehydrate` |
| `accord spec-gaps` | `queries/spec-gaps` |
| `accord gaps` | `queries/gaps` (`--tickets` spawns via harness) |

**Files:** `packages/accord-cli/src/commands/*.ts`, `cli.ts`, [`accord-cli.md`](../accord-cli.md).

### Acceptance criteria

- Fresh install: `accord resume <ID> --harness exec` with configured `harness.exec` — **no Pi packages in `node_modules`**.
- `npm run check` green.
- New test: CLI module graph loads without `pi-accord` installed.

### Status

- [x] 1a optional Pi harness
- [x] 1b config paths
- [x] 1c CLI parity

---

## Phase 2 — Extract MCP + hook host port

**Objective:** MCP is a first-class non-Pi package; hooks are invokable from any host.

### 2a — `accord-mcp` package

| Change | Detail |
|--------|--------|
| New package | `packages/accord-mcp/` |
| Move | `pi-accord/src/adapters/mcp/*` → `accord-mcp` |
| Depends | `accord-core`, `accord-cli` only |
| Root script | `bun run mcp` points to new entry |
| Compat | `pi-accord` thin-reexport or delegate (one release) |

### 2b — `HarnessHost` lifecycle port

Define in `accord-core` (e.g. `src/types/harness-host.ts`):

```typescript
interface HarnessHost {
  onSessionStart?(ctx: SessionStartContext): void;
  onBeforeToolCall?(tool: string, input: unknown): void;
  onAfterToolCall?(tool: string, result: unknown): void;
  onArtifactWrite?(path: string, content: string): ValidationResult;
  onSubagentPrepare?(spawn: SubagentSpawnRequest): PreflightResult;
  onSubagentResult?(result: SubagentResult): void;
  runJudgment?(request: JudgmentRequest): JudgmentPacket | undefined;
  notify(level: NotifyLevel, text: string): void;
}
```

| Host | Mapping |
|------|---------|
| **Pi** | `pi-hook-listeners.ts` → `HarnessHost` |
| **MCP** | Noop host + docs for client-side wiring |
| **CLI exec** | stderr `notify` + validation in `spawn-pipeline.ts` |

Ship **`packages/accord-mcp/examples/cursor-hooks/`** (or `examples/cursor-hooks/` at repo root) calling:

- `validateArtifactOnWrite`
- `runPostCodeVerification`
- `prepareSubagentToolCall` / `processSubagentToolResult`

### Acceptance criteria

- MCP server starts with zero Pi deps.
- Contract test: identical `dev_orchestrate` payload from Pi tools vs MCP.
- Example Cursor hooks documented + smoke fixture.

### Status

- [x] 2a accord-mcp package
- [x] 2b HarnessHost port + examples

---

## Phase 3 — Agent runtime backends

**Objective:** Realistic non-Pi agent execution beyond a bare `exec` template.

### 3a — Harden `exec` harness

- JSON schema validation for `harness.exec` on `accord init` / config load.
- Documented presets (data-only): Cursor agent CLI, `claude -p`, custom runner.
- Return-packet parser: stdout / stderr / file (`response_json` modes).
- Integration test with fake runner returning valid return packet.

### 3b — Harness plugin registry

```typescript
type AgentHarnessId = "exec" | "pi" | string;
```

- `accord.json`: `harness.default`, optional `harness.plugins[]`.
- `createHarness(id)` resolves built-ins + npm plugins exporting `createAgentHarness`.

### 3c — Judgment off Pi

- Core: `judgment-host.ts` port (validation + template merge already in `judgment.ts`).
- CLI impl: `ACCORD_ORCHESTRATION_JUDGMENT=1` + OpenAI-compatible HTTP **or** optional `@earendil-works/pi-ai`.
- Pi host delegates to same core helper.

### 3d — In-process harness spike (optional)

- Evaluate `createAgentSession` vs child-process isolation.
- **Default remains child-process** unless spike proves safe + fast.

### Acceptance criteria

- E2E: `accord resume DEMO-1 --harness exec` with fake agent.
- Judgment runs in CLI with API key — no Pi session.

### Status

- [ ] 3a exec harden
- [ ] 3b plugin registry
- [ ] 3c judgment port
- [ ] 3d in-process spike (optional)

---

## Phase 4 — Asset and skill neutrality

**Objective:** Install agents/providers/skills without Pi config layout.

### 4a — Split manifests

| Package / dir | Contents |
|---------------|----------|
| `accord-assets` | agents, providers, lang-profiles (unchanged) |
| `accord-assets/skills/` or `accord-skills/` | `commit`, `pr`, `review` as host-neutral playbooks |
| `pi-accord/assets/skills/` | Thin Pi SKILL wrappers referencing playbooks |

### 4b — Host-neutral install

- New CLI: `accord assets install [--dry-run] [--host pi|neutral]`.
- Default target: `~/.config/accord/`.
- Pi target: `~/.config/pi/agent/` only with `--host pi` or `ACCORD_HOST=pi`.
- Deprecate unconditional auto-install on Pi `session_start` unless `asset_bootstrap.auto_install` + host=pi.

### Acceptance criteria

- `accord assets install --dry-run` works without Pi.
- Pi extension still auto-links when configured.

### Status

- [ ] 4a skills split
- [ ] 4b neutral install CLI

---

## Phase 5 — Pi as optional client

**Objective:** `pi-accord` is a host adapter, not the product entry point.

### 5a — Thin Pi adapter

- All spawn paths → `accord-cli` harness pipeline (in-process Pi uses same path as headless).
- `extension_local` handlers → UI only (formatting, autocomplete, plan-mode gates).
- No direct `runSubagent` outside harness adapter.

### 5b — Optional companion packages

- Document minimal install: `accord-cli` + `accord-core` + `accord-assets`.
- Full Pi: `pi install` + optional `pi-subagent`, `pi-worktree`, etc.

### Acceptance criteria

- Pi smoke: `/dev resume`, `/dev finish`, free-text classify unchanged.
- Orchestration logic not duplicated in `extension.ts`.

### Status

- [ ] 5a thin adapter
- [ ] 5b docs + optional companions

---

## Phase 6 — CI, docs, cleanup

### 6a — Headless CI path

- `accord-ci` (new or rename sibling): `accord resume --harness exec` + configured runner.
- Keep `pi-accord-ci` for consumers on Pi autopipeline.

### 6b — Docs sweep

Update: [`accord-cli.md`](../accord-cli.md), [`concepts.md`](../concepts.md), [`local-development.md`](../local-development.md), [`hooks-and-tools.md`](../hooks-and-tools.md), README.

- "Getting started without Pi" quickstart.
- Host feature matrix (Pi vs MCP vs CLI vs Cursor hooks).
- Migration: config path, explicit `--harness pi`.

### 6c — Orchestration cleanup

- Wire `spawn_chain` in resume planner **or** document as deferred (S0c).
- Remove dead skill references and duplicate prompts.
- Document exec batching when harness supports chain in one subprocess.

### Acceptance criteria

- 15-minute onboarding path without Pi.
- CI job: `accord-cli` tests without `pi-accord` in `node_modules`.

### Status

- [ ] 6a headless CI
- [ ] 6b docs sweep
- [ ] 6c orchestration cleanup

---

## Suggested PR order (critical path)

```
Phase 0 (this doc)
  → Phase 1a optional pi harness
  → Phase 1b config paths
  → Phase 2a accord-mcp extract
  → Phase 2b HarnessHost + cursor examples
  → Phase 3a exec harden + Phase 3c judgment
  → Phase 1c CLI parity
  → Phase 4 assets split
  → Phase 5 thin pi
  → Phase 6 ci + docs
```

**Parallel after 1a:** Phase 3b harness plugins, Phase 4a skills split.

---

## Risk register

| Risk | Mitigation |
|------|------------|
| Breaking Pi users on default harness change | Deprecation: default `pi` when Pi detected; env `ACCORD_HARNESS`; release notes |
| `exec` too weak for real agents | Two reference runners + return-packet contract tests |
| MCP clients won't wire hooks | Document minimum hook set; optional `accord watch` daemon (future) |
| Judgment needs many LLM providers | OpenAI-compatible HTTP first; `pi-ai` optional peer |
| Large blast radius | Feature flags per phase; small PRs |

---

## Success metrics

1. **Pi-free install:** `npm i @clive.shirley/accord-cli` → `accord resume` with `harness.exec` config.
2. **Pi-free MCP:** stdio server starts; `dev_orchestrate` + `dev_tasks` work.
3. **Runtime swap:** change `harness.exec.command` only — no core edits.
4. **Pi unchanged:** existing `/dev` users see no behaviour regression.
5. **Headless CI:** GitHub Action runs implement loop via `exec` harness.

---

## Related documentation

- [`accord-cli-extraction.md`](accord-cli-extraction.md) — completed extraction phases 1–5
- [`harness-orchestration-implementation-plan.md`](harness-orchestration-implementation-plan.md) — orchestration in core (complete)
- [`pi-sdk-upgrade-plan.md`](pi-sdk-upgrade-plan.md) — Pi SDK adoption (separate track)
- [`file-structure.md`](../file-structure.md) — monorepo layout
