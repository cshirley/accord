# Project configuration

## Global config (`~/.config/accord/accord.json`)

Run `accord config init --write` to generate a global config with detected harness backends (`pi`, `claude`, `cursor`) and per-tier model defaults (`reasoning`, `workhorse`, `lightweight`, `review`). Use `--force` to overwrite an existing file.

```bash
accord config init              # dry-run (prints JSON)
accord config init --write -y   # non-interactive write
accord config init --write --harness claude
```

Project-level overrides still live in AGENTS.md (below).

## Project AGENTS.md

Lives in the project's `AGENTS.md` under the compatibility heading `## Dev Harness` as a fenced JSON block. Created by `/dev init`:

1. Detects stack from marker files (`go.mod`, `Cargo.toml`, `package.json`, etc.)
2. Infers commands from project config (`package.json` scripts, `pyproject.toml` tool sections, Makefile targets)
3. Falls back to `packages/accord-assets/lang-profiles/<lang>.json` for gaps
4. User confirms, then writes

The block is validated against `packages/accord-core/schemas/accord-schema.json`. See [`docs/extending.md`](extending.md) for how to add custom providers in this same JSON block.

## Quick-fix loop policy (`orchestration.quick_fix_loop`)

When the harness applies a validated **`review-test`** return packet for a **`quick_fix`** work item in **`fixing`**, it uses optional fields under `orchestration.quick_fix_loop` (defaults match `packages/accord-core/src/orchestration/policy.ts`):

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

## Harness backends and tiers

`accord config init` writes `harness.backends[]` (one entry per installed CLI) and `harness.tiers` (per-tier `harness`, `model`, `thinking`). At spawn time, accord-cli resolves the backend from the agent markdown `tier:` frontmatter (or review agent name) and routes to `pi` or the matching exec backend.

Example (abbreviated):

```json
"harness": {
  "default": "claude",
  "backends": [
    { "id": "claude", "label": "Claude Code", "kind": "exec", "command": ["bun", "packages/accord-cli/scripts/claude-code-exec.ts", "..."] },
    { "id": "cursor", "label": "Cursor Agent", "kind": "exec", "command": ["bun", "packages/accord-cli/scripts/cursor-agent-exec.ts", "..."] },
    { "id": "pi", "label": "Pi CLI", "kind": "pi" }
  ],
  "tiers": {
    "reasoning": { "harness": "claude", "model": "claude-opus-4-7", "thinking": "high" },
    "workhorse": { "harness": "cursor", "model": "composer-2.5", "thinking": "medium" },
    "review": { "harness": "pi", "model": "anthropic/claude-opus-4-7", "thinking": "xhigh" }
  }
}
```

Legacy `harness.exec` (single command) remains supported for `default: "exec"`.

## Exec harness (`harness.exec`)

For `accord --harness exec` and `ACCORD_MCP_HARNESS=exec`. Subprocess template; core contract unchanged (`exitCode` + parsed return packet).

### Pi CLI preset

Built-in `--harness pi` spawns isolated `pi --mode json -p` subprocesses via `pi-subagent` (no `pi-accord` required). Frontmatter resolves through `subagent.json` the same way as `/dev` subagent spawns.

Optional exec preset (same backend, file-based argv):

```json
"harness": {
  "default": "exec",
  "exec": {
    "command": [
      "bun",
      "packages/accord-cli/scripts/pi-exec.ts",
      "--agent={{agentId}}",
      "--agent-file={{agentFile}}",
      "--task-file={{taskFile}}",
      "--system-append-file={{systemAppendFile}}",
      "--cwd={{cwd}}"
    ],
    "response_json": "stdout"
  }
}
```

Preset: `PI_EXEC_HARNESS` from `@clive.shirley/accord-cli`.

### Claude Code CLI preset

Bundled backend for the Anthropic `claude` binary (`claude -p`). Frontmatter (`tier`, `model`, `thinking`) resolves through `subagent.json` → `claude --model` + `--effort`. Agent **body** → `--system-prompt`; project stack → `--append-system-prompt`; orchestrator task → prompt arg. Tool flags map to `--tools`.

Use an **Anthropic-direct** profile in `subagent.json` (e.g. `anthropic-direct`) — Cursor-shaped model ids are invalid here.

```json
"harness": {
  "default": "exec",
  "exec": {
    "command": [
      "bun",
      "packages/accord-cli/scripts/claude-code-exec.ts",
      "--agent={{agentId}}",
      "--agent-file={{agentFile}}",
      "--task-file={{taskFile}}",
      "--system-append-file={{systemAppendFile}}",
      "--cwd={{cwd}}"
    ],
    "response_json": "stdout"
  }
}
```

Preset: `CLAUDE_CODE_EXEC_HARNESS` from `@clive.shirley/accord-cli`. Override binary: `ACCORD_CLAUDE_CODE_BIN`. Permissions: `ACCORD_CLAUDE_SKIP_PERMISSIONS=1` (default) adds `--dangerously-skip-permissions`.

### Cursor Agent CLI preset

Bundled backend for the Cursor `agent` binary. Agent markdown **frontmatter** (`tier`, `model`, `thinking`) is the **control plane** — resolved through `~/.config/pi/agent/subagent.json` profiles and mapped to `agent --model`. Frontmatter is **not** passed as argv or prompt text (YAML `---` would collide with CLI parsing).

The prompt is: agent body + `systemAppend` (project stack) + orchestrator task.

```json
"harness": {
  "default": "exec",
  "exec": {
    "command": [
      "bun",
      "packages/accord-cli/scripts/cursor-agent-exec.ts",
      "--agent={{agentId}}",
      "--agent-file={{agentFile}}",
      "--task-file={{taskFile}}",
      "--system-append-file={{systemAppendFile}}",
      "--cwd={{cwd}}"
    ],
    "response_json": "stdout"
  }
}
```

Programmatic preset: `CURSOR_AGENT_EXEC_HARNESS` from `@clive.shirley/accord-cli`. Override binary with `ACCORD_CURSOR_AGENT_BIN`.

### Generic exec template

```json
"harness": {
  "exec": {
    "command": ["my-runner", "--agent", "{{agentId}}", "--task-file", "{{taskFile}}"],
    "response_json": "stdout",
    "env": { "MY_FLAG": "1" }
  }
}
```

Tokens: `{{agentId}}`, `{{agent}}`, `{{task}}`, `{{taskFile}}`, `{{agentFile}}`, `{{systemAppendFile}}`, `{{cwd}}`. See [`accord-cli.md`](accord-cli.md).

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

Optional **Phase 5** bounded LLM step before certain `/dev resume` subagent spawns (default agents: `review-test`, `phase-test`). The model returns JSON validated against `packages/accord-core/schemas/orchestration-judgment-packet.json`; invalid output gets a **template** appendix instead. Routing stays in core — the packet must not include agent or tool routing fields.

| Field | Type | Meaning |
|-------|------|--------|
| `enabled` | boolean | When `true`, eligible resume spawns may run judgment (still requires env gate on Pi). |
| `agents` | string[] | Optional allowlist of dispatch agent ids; defaults to `review-test` and `phase-test`. |
| `model` | string | Model for judgment `completeSimple` (`provider/model` or bare id). Independent of the interactive chat model. |
| `thinking` | string | Thinking level when the provider uses flag thinking (`off` … `xhigh`, `max`). |
| `max_tokens` | integer 256–8192 | Cap for the judgment completion (default `1536`). |

Also set **`ACCORD_ORCHESTRATION_JUDGMENT=1`** in the Pi environment so the extension actually calls the judgment model. Without that env var, judgment is skipped at the host and the harness uses the template appendix when `enabled` is true.

### Judgment model resolution (Pi)

When judgment runs, the model is chosen in order:

1. `orchestration.judgment.model` (+ optional `thinking`)
2. `subagent.json` **lightweight** tier for the active profile
3. Last entry in the parent Pi session **scoped models** list (when `enabledModels` / `--models` is configured)
4. Interactive **chat model** (`ctx.model`) — emits a warning; prefer setting `judgment.model`

Subagent **spawns** are unchanged: they always follow agent `tier:` + `subagent.json`, not scoped models.

### Three-layer model policy

| Layer | Purpose | Configuration |
|-------|---------|----------------|
| Interactive chat | Pair-programming in the parent Pi session | Pi `defaultModel`, `/model`, Ctrl+P scoped cycling |
| Orchestration judgment | Bounded `completeSimple` before certain resume spawns | `orchestration.judgment.model` → lightweight tier → scoped fallback → chat model |
| Subagent spawns | Isolated phase/review child `pi` processes | Agent frontmatter `model:` / `tier:` → `subagent.json` profiles |

`dev_subagent_preflight` surfaces `scoped_models` and `judgment_model` on Pi and **warns** (does not block) when spawn or judgment models are outside the scoped shortlist.

## Core orchestrator (`ACCORD_CORE_ORCHESTRATOR`)

Programmatic `/dev` workflow routing (align, spec, plan, resume, finish, check, amend-spec, and conditional gaps/deviations spawns) runs through **`packages/accord-core/src/orchestration/`** by default. The env var **`ACCORD_CORE_ORCHESTRATOR`** defaults to **on** when unset; set to `0`, `false`, `no`, or `off` to disable programmatic spawns. The bundled accord skill was removed — disabling the orchestrator leaves only local extension handlers and in-session `dev_*` / `subagent` tooling.

Global defaults can live in `~/.config/pi/agent/accord.json` under `orchestration` (merged into each project's Dev Harness block; project subsections override). Per-project overrides still go in the `## Dev Harness` JSON in `AGENTS.md`.

## Resume replan loop (`orchestration.resume`)

Each `/dev resume` under the core orchestrator can chain multiple subagent spawns until a stop condition. Defaults match `packages/accord-core/src/orchestration/policy.ts`:

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

When `on_task_done` is `false`, the Pi orchestration host skips per-task git commits. The default is **`true`**: after **review-code** marks a plan task `done`, the harness stages task-scoped paths and commits without interactive `/commit` skill confirmation.

| Field | Type | Default | Meaning |
|-------|------|---------|--------|
| `on_task_done` | boolean | `true` | Stage task-scoped paths (`plan.tasks[].files`, `test_files`, `docs/dev/<ID>/`) intersected with `git status`, then `git commit`. Records a `harness_task_commit` event on the task file. Set `false` to disable auto-commit. |

Example — disable per-task commits (e.g. when you prefer manual `/commit`):

```json
"orchestration": {
  "resume": { "no_auto_chain_agents": [], "max_sequential_spawns": 32 },
  "commit": { "on_task_done": false }
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
