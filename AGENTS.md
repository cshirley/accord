# ACCORD Pi Extension

This directory is the `@clive.shirley/pi-accord` Pi package. It provides ACCORD, an agentic delivery harness exposed through the `/dev` command. The extension helps agents and users agree the work, persist that agreement as schemas and artifacts, route phase agents, and verify implementation evidence before final handoff.

## Extension Surface

This npm package registers **multiple Pi extensions** (see `package.json` → `pi.extensions`): `pi-subagent`, `pi-worktree`, `pi-thrift`, `pi-git-tools`, `pi-tools`, then the ACCORD harness. Install this package once with the Pi CLI (`pi install <path-to-this-repo>`); you do not need separate copies under `~/.pi/agent/extensions/` for those tools.

- `src/index.ts` is the harness entry point and delegates to `src/adapters/pi/extension.ts`.
- `src/adapters/pi/extension.ts` registers the `/dev` command, autocomplete, tools, hooks, and status bar integration.
- `/dev` handles deterministic routes such as `help`, `tasks`, `retro`, and `tag` locally; most workflow subcommands are forwarded to `/skill:accord`.
- Pi tools in `src/adapters/pi/tools.ts` are thin wrappers around host-neutral core functions. Keep orchestration logic in `src/core/`, not in the Pi adapter.
- Pi hooks in `src/adapters/pi/hooks.ts` enforce schema validation, config reload, agent brief injection, gather/verify preflight, usage accounting, post-code verification, and pending-decision notifications.

## Runtime Dependencies

This extension is one part of the larger pi.dev harness. The package bundles its Pi prompt assets under `assets/`, and local installed copies may also exist under `~/.config/pi/agent/` for development:

- The canonical `accord` skill is bundled at `assets/skills/accord/SKILL.md`. The `/dev` command forwards workflow requests to `/skill:accord`, and that skill owns orchestration across phases. `assets/skills/dev/SKILL.md` is only a legacy shim. Companion skills ship beside it: `commit`, `pr`, and `review` (see `assets/skills/*/SKILL.md`) — thin playbooks over `packages/pi-git-tools` and the bundled `review-*` agents.
- The **`subagent` tool** lives in `packages/pi-subagent/`. The `accord` skill delegates each phase or review step through it so every phase runs in an isolated Pi process.
- Agent definition files are bundled at `assets/agents/accord/*.md`, covering all `phase-*` and `review-*` agents. The `accord/` namespace is path-derived: subagent's discovery walker tags each file with `namespace = "accord"`, which lets `subagent.json` apply per-skill profile overrides without any frontmatter change.
- Provider prompts are bundled at `assets/providers/trackers/*.md` (primary ticket sources) and `assets/providers/enrichments/*.md` (supplementary context); each is paired with a `<name>.json` connectivity sidecar (validated by `schemas/provider-schema.json`). `src/integrations/provider-deps.ts` loads the sidecars at runtime — there is no separate hardcoded dependency map. `phase-gather` reads the markdown playbooks (via the absolute paths the orchestrator injects in the preflight report) to fetch context. Providers are not invokable agents (no frontmatter).
- Projects can declare additional providers (or override a bundled provider by name) in `accord.json` under the top-level `providers` array. Each entry has the same shape as a sidecar but with an absolute or `~/`-prefixed `promptFile`. The merged provider set is what the gather preflight checks and what phase-gather receives.
- `src/core/agents/registry.ts`, `assets/providers/{trackers,enrichments}/*.json`, and `assets/manifest.json` must stay aligned (the asset validator enforces this).

Do not treat this package as a standalone workflow engine. The extension supplies `/dev` command wiring, tools, hooks, schemas, validation, status, and telemetry; the skill and agent definitions supply the actual orchestration prompts and execution roles.

## Project Layout

- `packages/` holds additional Pi extensions shipped with this repo (Bun workspaces): `pi-subagent`, `pi-worktree`, `pi-thrift`, `pi-git-tools`, `pi-tools`. Each has its own `package.json` and `src/` entry loaded via the root `pi.extensions` list.
- `src/` holds all TypeScript source code for the ACCORD harness:
  - `src/core/` contains host-neutral ACCORD logic: config, command dispatch, work items, artifacts, brief construction, verification, queries, telemetry, and agent metadata.
  - `src/adapters/pi/` contains Pi-specific integration code. Pi APIs should not leak into `src/core/`.
  - `src/adapters/mcp/` exposes the same `dev_*` tools over stdio MCP.
  - `src/integrations/` contains provider/enrichment dependency metadata used by `phase-gather`.
- `assets/` contains packaged Pi install assets: skills, agent definitions, providers (trackers + enrichments, each as a `.md` playbook + `.json` sidecar), language profiles, and `manifest.json`.
- `scripts/install-assets.ts` links bundled Pi assets into a host Pi config directory; it refuses to replace local modifications unless `--force` is supplied.
- `scripts/install-dev.sh` (via **`bun run install:dev`**) runs **`pi install`** on this repo then **`bun run install:assets`**; optional arguments install additional Pi package roots first.
- `schemas/` is the source of truth for persisted artifacts and agent return packets. Update schemas, validated examples, and registry metadata together.
- `assets/lang-profiles/` contains default command profiles used by `/dev init`.
- `.tasks/` holds runtime work item state and usage logs; it is transient.
- `docs/dev/<ID>/` holds committed work artifacts such as `brief.md`, `spec.json`, `plan.json`, `verify.json`, and `verify.md`.
- `docs/*.md` (excluding `docs/dev/`) are the project documentation: `concepts.md`, `pipeline.md`, `artifacts.md`, `schemas.md`, `hooks-and-tools.md`, `packaged-assets.md`, `configuration.md`, `extending.md`, `file-structure.md`, `local-development.md`. README.md is the slim entry point and links to each.

## Development Notes

- Prefer `const` over `let` for bindings that are never reassigned; use `let` only when the reference is updated after initialization. Agents and contributors should default to `const` so intent stays obvious and matches common ESLint `prefer-const` style.
- Prefer descriptive loop and index names (`commentIndex`, `tokenOffset`) over single letters (`i`, `j`, `k`). Reserve short indices only for truly generic numeric ranges where a longer name adds no meaning (e.g. a tiny mathematical inner product).
- **Biome** (`biome.json`) is the JS/TS/JSON formatter and linter: `bun run lint` or `bun run check:biome` (stricter than `recommended` alone — see rules in config). CI runs this via `npm run check`. Apply fixes with `bun run check:biome:fix` (add `--unsafe` locally when you accept those fixes).
- Diagnostic logging is off by default (level `error`). Set `"log_level": "debug"` in the `## Dev Harness` JSON block, or export `ACCORD_LOG_LEVEL=debug`, to see all internal traces on stderr. Levels: `debug`, `info`, `warn`, `error`, `silent`.
- Use Bun for local execution: `bun test`, `bun run validate:schemas`, `bun run validate:assets`, `bun run check:types`, `bun run check:bundle`, and `bun run check:runtime`.
- Use `bun run install:assets --dry-run` to preview linking bundled skills and agents into `~/.config/pi/agent`.
- Use the Pi CLI **`pi install <path>`** (from any shell) to add this repo to global `settings.json` → `packages`, or run **`bun run install:dev`** (`scripts/install-dev.sh`) to `pi install` this repo and then **`bun run install:assets`**. Pi loads `package.json` → `pi` (extensions, skills, prompts, themes) from that checkout. Use **`pi install -l <path>`** for project-local `.pi/settings.json`. **`pi list`** / **`pi remove <source>`** inspect or drop entries. If you still have a legacy `extensions/accord` symlink, remove it so the harness is not loaded twice; run **`pi install <path>`** again for each other local Pi package checkout you develop alongside ACCORD (or pass those paths as arguments to `scripts/install-dev.sh` before the script installs this repo).
- `npm run check` runs the full validation suite declared in `package.json`.
- When adding or changing an agent, update `assets/agents/accord/<agent>.md`, `assets/manifest.json`, `src/core/agents/registry.ts`, add or adjust `schemas/return-schemas/<agent>.json`, and keep `schemas/examples/<agent>.json` valid.
- When adding or changing a bundled provider or enrichment, drop the playbook + sidecar into `assets/providers/{trackers,enrichments}/<name>.{md,json}` (validated against `schemas/provider-schema.json`) and add the name to `assets/manifest.json`. The loader picks the sidecar up automatically — no TS edits required.
- When changing artifact shapes, update the matching schema and `src/core/artifacts/validation.ts` mappings if a new persisted file type is introduced.
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
