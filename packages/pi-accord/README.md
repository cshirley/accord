# @clive.shirley/pi-accord-harness

ACCORD harness Pi extension — `/dev` command, `dev_*` tools, hooks, orchestration, and MCP adapter.

Loaded via the root `@clive.shirley/pi-accord` package (`package.json` → `pi.extensions`).

## Layout

- `src/` — TypeScript source (`core/`, `adapters/`, `integrations/`)
- `assets/` — bundled skills, agents, providers, `manifest.json`
- `schemas/` — artifact and return-packet JSON schemas
- `scripts/` — `install-assets`, `validate-assets`, `runtime-smoke`
- `tests/` — Bun unit tests

## Commands (from repo root)

```bash
bun test packages/pi-accord/tests
bun run validate:assets
bun run validate:schemas
bun run install:assets
```
