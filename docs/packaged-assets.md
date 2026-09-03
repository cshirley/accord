# Packaged ACCORD assets

Host-neutral prompt assets ship from **`packages/accord-assets/`**; Pi-only companion skills and CI templates stay under **`packages/pi-accord/assets/`**.

```mermaid
flowchart TB
  A["accord-assets/"] --> M["manifest.json"]
  A --> L["lang-profiles/*.json"]
  A --> AG["agents/accord/ — phase-*.md, review-*.md"]
  A --> PR["providers/"]
  PR --> TR["trackers/(name).md + .json"]
  PR --> EN["enrichments/(name).md + .json"]
  P["pi-accord/assets/"] --> SK["skills/"]
  SK --> SA["commit, pr, review — SKILL.md"]
  P --> CI["ci/ — subagent.json, thrift.json"]
```

Root `package.json` advertises agents via `pi.agents` → `packages/accord-assets/agents` and skills via `pi.skills` → `packages/pi-accord/assets/skills/*`. Workflow routing lives in `packages/accord-core/src/orchestration/` (Pi and `accord` CLI).

## Installer

```bash
bun run install:assets
```

Links **accord-assets** (agents, providers, default.md) and **pi-accord skills** into `~/.config/pi/agent`. Refuses to replace locally modified files unless `--force`. Writes `.accord-assets.json` with combined manifest checksum.

Override roots: `ACCORD_ASSETS_DIR`, `ACCORD_PI_PKG_DIR` (see `packages/accord-core/src/config/paths.ts`).

## Validation

```bash
bun run validate:assets
```

Runs:

1. `packages/accord-assets/scripts/validate-assets.ts` — agents ↔ registry ↔ schemas ↔ provider sidecars
2. `packages/pi-accord/scripts/validate-pi-skills.ts` — skills ↔ `package.json` `pi.skills`

## Agent registry

`packages/accord-core/src/agents/registry.ts` maps agent names to runtime behaviour. Bundled markdown: `packages/accord-assets/agents/accord/<name>.md`. Return schemas: `packages/accord-core/schemas/return-schemas/<name>.json`. See [`docs/extending.md`](extending.md).
