# Project configuration

Lives in the project's `AGENTS.md` under the compatibility heading `## Dev Harness` as a fenced JSON block. Created by `/dev init`:

1. Detects stack from marker files (`go.mod`, `Cargo.toml`, `package.json`, etc.)
2. Infers commands from project config (`package.json` scripts, `pyproject.toml` tool sections, Makefile targets)
3. Falls back to `assets/lang-profiles/<lang>.json` for gaps
4. User confirms, then writes

The block is validated against `schemas/accord-schema.json`. See [`docs/extending.md`](extending.md) for how to add custom providers in this same JSON block.

## Quick-fix loop policy (`orchestration.quick_fix_loop`)

When the harness applies a validated **`review-test`** return packet for a **`quick_fix`** work item in **`fixing`**, it uses optional fields under `orchestration.quick_fix_loop` (defaults match `src/core/orchestration/policy.ts`):

| Field | Type | Default | Meaning |
|-------|------|---------|--------|
| `max_test_review_loops` | integer ≥ 0 | `5` | After this many consumed `test↔review` retries (stored on the per-task file as `quick_fix_loop.test_review_cycles_used`), further gated `issues` verdicts set the task `status` to `blocked`. |
| `severity_gate` | `"none"` \| `"warn"` \| `"block"` | `"warn"` | Which finding severities count as consuming a retry when verdict is `issues`: `none` = all issues; `warn` = warning or critical; `block` = critical only. |

Example:

```json
"orchestration": {
  "quick_fix_loop": {
    "max_test_review_loops": 3,
    "severity_gate": "warn"
  }
}
```

## Implement review retry policy (`orchestration.review_loop`)

When **`review-test`** or **`review-code`** completes for an **`implement`** work item (or **`review-code`** on **quick_fix**), the harness uses `orchestration.review_loop`:

| Field | Type | Default | Meaning |
|-------|------|---------|--------|
| `max_critical_retries` | integer ≥ 0 | `3` | Max retries per agent loop when gated findings fire. |
| `severity_gate` | `"none"` \| `"warn"` \| `"block"` | `"block"` | Which severities consume a retry: `block` = critical only; `warn` = warning or critical; `none` = any finding. |
| `review_test` | object | — | Optional override for **review-test** → **phase-test** (`severity_gate`, `max_retries`). |
| `review_code` | object | — | Optional override for **review-code** → **phase-code**. |

Example (strict test review, lenient code review):

```json
"orchestration": {
  "review_loop": {
    "severity_gate": "block",
    "max_critical_retries": 3,
    "review_test": { "severity_gate": "warn", "max_retries": 5 }
  }
}
```

Post-result footers and resume briefs echo the active gate (`severity_gate=…`).

## Orchestration judgment (`orchestration.judgment`, Pi)

Optional **Phase 5** bounded LLM step before certain `/dev resume` subagent spawns (default agents: `review-test`, `phase-test`). The model returns JSON validated against `schemas/orchestration-judgment-packet.json`; invalid output gets a **template** appendix instead. Routing stays in core — the packet must not include agent or tool routing fields.

| Field | Type | Meaning |
|-------|------|--------|
| `enabled` | boolean | When `true`, eligible resume spawns may run judgment (still requires env gate on Pi). |
| `agents` | string[] | Optional allowlist of dispatch agent ids; defaults to `review-test` and `phase-test`. |
| `max_tokens` | integer 256–8192 | Cap for the judgment completion (default `1536`). |

Also set **`ACCORD_ORCHESTRATION_JUDGMENT=1`** in the Pi environment so the extension actually calls the configured model. Without that env var, judgment is skipped at the host and the harness uses the template appendix when `enabled` is true.

## Core orchestrator (`ACCORD_CORE_ORCHESTRATOR`)

Programmatic `/dev` workflow routing (align, spec, plan, resume, finish, check, amend-spec, and conditional gaps/deviations spawns) runs through **`src/core/orchestration/`** by default. The env var **`ACCORD_CORE_ORCHESTRATOR`** defaults to **on** when unset; set to `0`, `false`, `no`, or `off` to disable programmatic spawns. The bundled accord skill was removed — disabling the orchestrator leaves only local extension handlers and in-session `dev_*` / `subagent` tooling.

Global defaults can live in `~/.config/pi/agent/accord.json` under `orchestration` (merged into each project's Dev Harness block; project subsections override). Per-project overrides still go in the `## Dev Harness` JSON in `AGENTS.md`.

## Resume replan loop (`orchestration.resume`)

Each `/dev resume` under the core orchestrator can chain multiple subagent spawns until a stop condition. Defaults match `src/core/orchestration/policy.ts`:

| Field | Type | Default | Meaning |
|-------|------|---------|--------|
| `no_auto_chain_agents` | string[] | `["phase-code"]` | When the *next* planned spawn is one of these registry ids, the loop stops in the same command. Set `[]` to auto-chain through implementation (and raise `max_sequential_spawns` for multi-task plans). |
| `max_sequential_spawns` | integer ≥ 1 | `8` | Maximum subagent spawns per `/dev resume` before the loop returns. |

Example — run the full per-task loop (test → review → code → review) without stopping before `phase-code`:

```json
"orchestration": {
  "resume": {
    "no_auto_chain_agents": [],
    "max_sequential_spawns": 32
  }
}
```

## Per-task commit (`orchestration.commit`)

When `on_task_done` is `true`, the Pi orchestration host commits after **review-code** marks a plan task `done`. This bypasses the interactive `/commit` skill confirmation — use only on branches you are comfortable auto-committing.

| Field | Type | Default | Meaning |
|-------|------|---------|--------|
| `on_task_done` | boolean | `false` | Stage task-scoped paths (`plan.tasks[].files`, `test_files`, `docs/dev/<ID>/`) intersected with `git status`, then `git commit`. Records a `harness_task_commit` event on the task file. |

Example:

```json
"orchestration": {
  "resume": { "no_auto_chain_agents": [], "max_sequential_spawns": 32 },
  "commit": { "on_task_done": true }
}
```

## Supported stacks

| Language | Marker | Test | Type check | Lint |
|----------|--------|------|------------|------|
| TypeScript/JS | `package.json` | vitest, jest, mocha | tsc | eslint, biome |
| Go | `go.mod` | go test | go vet | golangci-lint |
| Rust | `Cargo.toml` | cargo test | cargo check | clippy |
| Python | `pyproject.toml` | pytest | mypy, pyright | ruff, flake8 |
| Ruby | `Gemfile` | rspec, rake test | — | rubocop |
| Java | `pom.xml` / `build.gradle` | mvn/gradle test | — | checkstyle |
| C#/.NET | `*.csproj` / `*.sln` | dotnet test | dotnet build | dotnet format |

Makefile targets (`test`, `lint`, `check`, `fmt`) override language defaults.
