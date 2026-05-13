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

## Orchestration judgment (`orchestration.judgment`, Pi)

Optional **Phase 5** bounded LLM step before certain `/dev resume` subagent spawns (default agents: `review-test`, `phase-test`). The model returns JSON validated against `schemas/orchestration-judgment-packet.json`; invalid output gets a **template** appendix instead. Routing stays in core — the packet must not include agent or tool routing fields.

| Field | Type | Meaning |
|-------|------|--------|
| `enabled` | boolean | When `true`, eligible resume spawns may run judgment (still requires env gate on Pi). |
| `agents` | string[] | Optional allowlist of dispatch agent ids; defaults to `review-test` and `phase-test`. |
| `max_tokens` | integer 256–8192 | Cap for the judgment completion (default `1536`). |

Also set **`ACCORD_ORCHESTRATION_JUDGMENT=1`** in the Pi environment so the extension actually calls the configured model. Without that env var, judgment is skipped at the host and the harness uses the template appendix when `enabled` is true.

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
