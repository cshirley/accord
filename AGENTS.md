# ACCORD Pi Extension

This directory is the `@clive.shirley/pi-accord` Pi package (Bun workspace monorepo). It provides ACCORD, an agentic delivery harness exposed through the `/dev` command. The extension helps agents and users agree the work, persist that agreement as schemas and artifacts, route phase agents, and verify implementation evidence before final handoff.

## Extension Surface

This npm package registers **multiple Pi extensions** (see root `package.json` → `pi.extensions`): `pi-subagent`, `pi-worktree`, `pi-thrift`, `pi-git-tools`, `pi-tools`, then the ACCORD harness in `packages/pi-accord`. Install this package once with the Pi CLI (`pi install <path-to-this-repo>`); you do not need separate copies under `~/.pi/agent/extensions/` for those tools.

- `packages/pi-accord/src/index.ts` is the harness entry point and delegates to `packages/pi-accord/src/adapters/pi/extension.ts`.
- `packages/pi-accord/src/adapters/pi/extension.ts` registers the `/dev` command, autocomplete, tools, hooks, and status bar integration.
- `/dev` handles deterministic routes locally (`help`, `tasks`, `retro`, `tag`, `init`, `spec-gaps`, `review` queue) and delegates workflow subcommands to `@clive.shirley/accord-cli` via `cli-client.ts`.
- Pi tools in `packages/pi-accord/src/adapters/pi/tools.ts` are thin wrappers around host-neutral core functions. Keep orchestration logic in `packages/accord-core/src/`, not in the Pi adapter.
- Pi hooks in `packages/pi-accord/src/adapters/pi/hooks.ts` enforce schema validation, config reload, agent brief injection, gather/verify preflight, usage accounting, post-code verification, and pending-decision notifications.

## Runtime Dependencies

This extension is one part of the larger pi.dev harness. The package bundles its Pi prompt assets under `packages/pi-accord/assets/`, and local installed copies may also exist under `~/.config/pi/agent/` for development:

- Workflow orchestration lives in `packages/accord-core/src/orchestration/`. Pi delegates workflow subcommands to `@clive.shirley/accord-cli`; headless: `bun run accord`. Companion skills: `commit`, `pr`, `review`.
- The **`subagent` tool** lives in `packages/pi-subagent/` (registered via root `package.json` → `pi.extensions`, not by reading `packages/pi-subagent/README.md`). To delegate work, **call the `subagent` tool** (`agent` + `task`); do not open the README for execution. The core orchestrator delegates each phase or review step through it so every phase runs in an isolated Pi process.
- Agent definition files are bundled at `packages/pi-accord/assets/agents/accord/*.md`, covering all `phase-*` and `review-*` agents. The `accord/` namespace is path-derived: subagent's discovery walker tags each file with `namespace = "accord"`, which lets `subagent.json` apply per-skill profile overrides without any frontmatter change.

### Review agent scope matrix

| Topic | Owner agent | Others |
| --- | --- | --- |
| OWASP / authz / secrets / supply chain | `review-security` | `review-code` defers |
| Test adequacy / adversarial gaps | `review-test` | `review-code` defers |
| Correctness / drift / observability | `review-code` | — |
| Spec structure / AC↔TC integrity | `review-spec` | — |
| Plan ordering / task coverage | `review-plan` | — |
| Design / ADR reasoning | `review-design` | — |
| Hypothesis quality | `review-investigation` | — |
| Plan deviation classification | `review-deviation` | — |

Harness routing: **pre-impl** `review-test` → `phase-code` → optional `review-security` → `review-code`. `phase-code` never writes tests; violations respawn `phase-test`.
- Provider prompts are bundled at `packages/pi-accord/assets/providers/trackers/*.md` (primary ticket sources) and `packages/pi-accord/assets/providers/enrichments/*.md` (supplementary context); each is paired with a `<name>.json` connectivity sidecar (validated by `packages/accord-core/schemas/provider-schema.json`). `packages/pi-accord/src/integrations/provider-deps.ts` loads the sidecars at runtime — there is no separate hardcoded dependency map. `phase-gather` reads the markdown playbooks (via the absolute paths the orchestrator injects in the preflight report) to fetch context. Providers are not invokable agents (no frontmatter).
- Projects can declare additional providers (or override a bundled provider by name) in `accord.json` under the top-level `providers` array. Each entry has the same shape as a sidecar but with an absolute or `~/`-prefixed `promptFile`. The merged provider set is what the gather preflight checks and what phase-gather receives.
- `packages/accord-core/src/agents/registry.ts`, `packages/pi-accord/assets/providers/{trackers,enrichments}/*.json`, and `packages/pi-accord/assets/manifest.json` must stay aligned (the asset validator enforces this).

Do not treat this package as a standalone workflow engine. The extension supplies `/dev` command wiring, tools, hooks, schemas, validation, status, and telemetry; the skill and agent definitions supply the actual orchestration prompts and execution roles.

## Project Layout

- `packages/` — Bun workspaces: **`accord-core`** (host-neutral), **`accord-cli`** (`accord` bin), **`pi-accord`** (Pi extension + MCP + assets), `pi-subagent`, `pi-worktree`, `pi-thrift`, `pi-git-tools`, `pi-tools`, `pi-accord-ci`.
- `packages/accord-core/` — orchestration, work items, artifacts, briefing, verification, schemas, `dev_*` tools, standalone review.
- `packages/accord-cli/` — CLI, harness registry, commands.
- `packages/pi-accord/src/adapters/pi/` — extension, hooks, `cli-client`, spawn UI.
- `packages/pi-accord/src/adapters/mcp/` — stdio MCP + `ACCORD_MCP_HARNESS`.
- `packages/pi-accord/assets/` — skills, agents, providers, lang-profiles.
- `packages/pi-accord/scripts/install-assets.ts` — links bundled assets into `~/.config/pi/agent/`.
- `packages/accord-core/schemas/` — artifact and return-packet schemas.
- `.tasks/` — transient runtime state; `docs/dev/<ID>/` — committed artifacts.
- `docs/*.md` — see README; [`docs/accord-cli.md`](docs/accord-cli.md) for standalone CLI.

## Development Notes

- Prefer `const` over `let` for bindings that are never reassigned; use `let` only when the reference is updated after initialization. Agents and contributors should default to `const` so intent stays obvious and matches common ESLint `prefer-const` style.
- Prefer descriptive loop and index names (`commentIndex`, `tokenOffset`) over single letters (`i`, `j`, `k`). Reserve short indices only for truly generic numeric ranges where a longer name adds no meaning (e.g. a tiny mathematical inner product).
- **Biome** (`biome.json`) is the JS/TS/JSON formatter and linter: `bun run lint` or `bun run check:biome` (stricter than `recommended` alone — see rules in config). CI runs this via `npm run check`. Apply fixes with `bun run check:biome:fix` (add `--unsafe` locally when you accept those fixes).
- Diagnostic logging is off by default (level `error`). Set `"log_level": "debug"` in the `## Dev Harness` JSON block, or export `ACCORD_LOG_LEVEL=debug`, to see all internal traces on stderr. Levels: `debug`, `info`, `warn`, `error`, `silent`.
- Use Bun for local execution: `bun test`, `bun run validate:schemas`, `bun run validate:assets`, `bun run check:types`, `bun run check:bundle`, and `bun run check:runtime`.
- Use `bun run install:assets --dry-run` to preview linking bundled skills and agents into `~/.config/pi/agent`.
- Use the Pi CLI **`pi install <path>`** (from any shell) to add this repo to global `settings.json` → `packages`, or run **`bun run install:dev`** (`scripts/install-dev.sh`) to `pi install` this repo and then **`bun run install:assets`**. Pi loads `package.json` → `pi` (extensions, skills, prompts, themes) from that checkout. Use **`pi install -l <path>`** for project-local `.pi/settings.json`. **`pi list`** / **`pi remove <source>`** inspect or drop entries. If you still have a legacy `extensions/accord` symlink, remove it so the harness is not loaded twice; run **`pi install <path>`** again for each other local Pi package checkout you develop alongside ACCORD (or pass those paths as arguments to `scripts/install-dev.sh` before the script installs this repo).
- `npm run check` runs the full validation suite declared in `package.json`.
- When adding or changing an agent, update `packages/pi-accord/assets/agents/accord/<agent>.md`, `packages/pi-accord/assets/manifest.json`, `packages/accord-core/src/agents/registry.ts`, add or adjust `packages/accord-core/schemas/return-schemas/<agent>.json`, and keep `packages/accord-core/schemas/examples/<agent>.json` valid.
- When adding or changing a bundled provider or enrichment, drop the playbook + sidecar into `packages/pi-accord/assets/providers/{trackers,enrichments}/<name>.{md,json}` (validated against `packages/accord-core/schemas/provider-schema.json`) and add the name to `packages/pi-accord/assets/manifest.json`. The loader picks the sidecar up automatically — no TS edits required.
- When changing artifact shapes, update the matching schema and `packages/accord-core/src/artifacts/validation.ts` mappings if a new persisted file type is introduced.
- Preserve the `## Dev Harness` section below. The extension reads its fenced JSON block from `AGENTS.md` at runtime.

## Dev Harness

<!-- Generated by /dev init. Edit freely; the harness reads this section at runtime. -->

```json
{
  "schema_version": "1.0",
  "language": "typescript",
  "test": {
    "command": "bun test",
    "file_pattern": "**/*.test.ts"
  },
  "type_check": "bun run check:types",
  "lint": "bun run check:biome && bun run validate:schemas && bun run validate:assets",
  "format": null,
  "tracker": {
    "type": "github"
  },
  "verification_commands": [
    "bun test",
    "bun run check:biome",
    "bun run validate:schemas",
    "bun run validate:assets",
    "bun run check:types",
    "bun run check:bundle",
    "bun run check:runtime"
  ]
}
```
