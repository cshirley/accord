# @clive.shirley/pi-accord

ACCORD harness Pi extension — `/dev` command, `dev_*` tools, hooks, and orchestration. MCP lives in `@clive.shirley/accord-mcp`.

Loaded via the root `@clive.shirley/accord` monorepo (`package.json` → `pi.extensions`).

## Layout

- `src/` — TypeScript source (`core/`, `adapters/`, `integrations/`)
- `assets/` — bundled skills, agents, providers, `manifest.json`
- `schemas/` — artifact and return-packet JSON schemas
- `scripts/` — `install-assets`, `validate-assets`, `runtime-smoke`
- `tests/` — Pi adapter unit tests (hooks, CLI client, spawn UI, dashboard display)

Host-neutral harness tests live in `packages/accord-core/tests/`; `pi-subagent` and `pi-thrift` own their extension tests.

## Commands (from repo root)

```bash
bun test packages/pi-accord/tests   # Pi adapter only
bun test                            # full monorepo
bun run validate:assets
bun run validate:schemas
bun run install:assets
```
