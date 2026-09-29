---
type: Reference
title: Dev Harness configuration
description: Project `## Dev Harness` JSON block in AGENTS.md, global accord.json, and stack detection.
tags: [configuration, agents-md, accord-json, init, stacks]
status: stable
generated: { by: agent:pi, at: 2026-09-28T16:41:59Z }
sources:
  - id: config-doc
    resource: /docs/configuration.md
    title: Project configuration
  - id: accord-schema
    resource: /packages/accord-core/schemas/accord-schema.json
    title: Dev Harness config schema
  - id: detect
    resource: /packages/accord-core/src/config/detect/index.ts
    title: Stack detection
  - id: paths
    resource: /packages/accord-core/src/config/paths.ts
    title: Config paths
---

# Layers

| Layer | Location | Written by |
|-------|----------|------------|
| Global | `~/.config/accord/accord.json` (`ACCORD_CONFIG_DIR`) | `accord config init --write` — harness backends + tiers |
| Global orchestration defaults | `~/.config/pi/agent/accord.json` → `orchestration` | Hand-edited; merged under project config |
| Project | `AGENTS.md` → `## Dev Harness` fenced JSON | `/dev init` / `accord init --write` |

Project subsections override global. The block is validated against `accord-schema.json`; the
heading name `## Dev Harness` must be preserved. Writing AGENTS.md triggers a config reload
hook in Pi.

# Project block keys

| Key | Purpose |
|-----|---------|
| `schema_version` | `"1.0"` |
| `language`, `detect_file` | Stack + marker file |
| `test` | `{ command, file_pattern }` — post-code advisory test run |
| `type_check` | Post-code **hard gate** command |
| `lint`, `format` | Commands (or `null`) |
| `verification_commands[]` | Run by verify preflight before `phase-verify-*`; block if all fail |
| `tracker` | `{ type }` — provider name (`jira` default, `github`, `gitlab`, `plain-text`, custom) |
| `providers[]` | Project-local provider sidecars ([Providers](/architecture/providers.md)) |
| `context_sources[]` | Enrichment overrides merged over global sources (`enabled: false` disables) |
| `monorepo` | `{ tool, root }` |
| `harness` | Backends/tiers/exec template (usually global) |
| `orchestration` | See [Orchestration policy](/references/orchestration-policy.md) |
| `log_level` | `debug` / `info` / `warn` / `error` (default) / `silent`; env `ACCORD_LOG_LEVEL` |

This repo's own block (TypeScript, `bun test`, Biome, schema/asset validation, `tracker: github`)
is the canonical example — see `/AGENTS.md`.

# Harness backends and tiers

```json
"harness": {
  "default": "claude",
  "backends": [
    { "id": "claude", "kind": "exec", "command": ["bun", "packages/accord-cli/scripts/claude-code-exec.ts", "..."] },
    { "id": "pi", "kind": "pi" }
  ],
  "tiers": {
    "reasoning": { "harness": "claude", "model": "claude-opus-4-7", "thinking": "high" },
    "workhorse": { "harness": "cursor", "model": "composer-2.5", "thinking": "medium" },
    "review":    { "harness": "pi", "model": "anthropic/claude-opus-4-7", "thinking": "xhigh" }
  }
}
```

Agent `tier:` frontmatter selects the tier. Legacy single `harness.exec` still works with
`default: "exec"`.

# Stack detection

`/dev init`: marker files → infer commands from project config (`package.json` scripts,
`pyproject.toml`, Makefile) → fill gaps from `accord-assets/lang-profiles/<lang>.json` → confirm →
write. Makefile `test`/`lint`/`check`/`fmt` override language defaults.

| Language | Marker | Test | Type check | Lint |
|----------|--------|------|------------|------|
| TypeScript/JS | `package.json` | vitest, jest, mocha | tsc | eslint, biome |
| Go | `go.mod` | go test | go vet | golangci-lint |
| Rust | `Cargo.toml` | cargo test | cargo check | clippy |
| Python | `pyproject.toml` | pytest | mypy, pyright | ruff, flake8 |
| Ruby | `Gemfile` | rspec, rake test | — | rubocop |
| Java | `pom.xml` / `build.gradle` | mvn/gradle test | — | checkstyle |
| C#/.NET | `*.csproj` / `*.sln` | dotnet test | dotnet build | dotnet format |

Init write targets: `local`, `root`, `root_replace`, `link_only`.
