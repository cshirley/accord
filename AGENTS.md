# ACCORD Pi Extension

This directory is the `@clive.shirley/pi-accord` Pi package. It provides ACCORD, an agentic delivery harness exposed through the `/dev` command. The extension helps agents and users agree the work, persist that agreement as schemas and artifacts, route phase agents, and verify implementation evidence before final handoff.

## Extension Surface

- `src/index.ts` is the package entry point and delegates to `src/adapters/pi/extension.ts`.
- `src/adapters/pi/extension.ts` registers the `/dev` command, autocomplete, tools, hooks, and status bar integration.
- `/dev` handles deterministic routes such as `help`, `tasks`, `retro`, and `tag` locally; most workflow subcommands are forwarded to `/skill:accord`.
- Pi tools in `src/adapters/pi/tools.ts` are thin wrappers around host-neutral core functions. Keep orchestration logic in `src/core/`, not in the Pi adapter.
- Pi hooks in `src/adapters/pi/hooks.ts` enforce schema validation, config reload, agent brief injection, gather/verify preflight, usage accounting, post-code verification, and pending-decision notifications.

## Runtime Dependencies

This extension is one part of the larger pi.dev harness. The package bundles its Pi prompt assets under `assets/`, and local installed copies may also exist under `~/.config/pi/agent/` for development:

- The canonical `accord` skill is bundled at `assets/skills/accord/SKILL.md`. The `/dev` command forwards workflow requests to `/skill:accord`, and that skill owns orchestration across phases. `assets/skills/dev/SKILL.md` is only a legacy shim.
- The subagent extension/tool. The `accord` skill delegates each phase or review step through the `subagent` tool so every phase runs in an isolated Pi process.
- Agent definition files are bundled at `assets/agents/accord/*.md`, covering all `phase-*` and `review-*` agents. The `accord/` namespace is path-derived: subagent's discovery walker tags each file with `namespace = "accord"`, which lets `subagent-config.json` apply per-skill profile overrides without any frontmatter change.
- Provider prompts are bundled at `assets/providers/trackers/*.md` (primary ticket sources) and `assets/providers/enrichments/*.md` (supplementary context); each is paired with a `<name>.json` connectivity sidecar (validated by `schemas/provider-schema.json`). `src/integrations/provider-deps.ts` loads the sidecars at runtime — there is no separate hardcoded dependency map. `phase-gather` reads the markdown playbooks (via the absolute paths the orchestrator injects in the preflight report) to fetch context. Providers are not invokable agents (no frontmatter).
- Projects can declare additional providers (or override a bundled provider by name) in `accord-config.json` under the top-level `providers` array. Each entry has the same shape as a sidecar but with an absolute or `~/`-prefixed `promptFile`. The merged provider set is what the gather preflight checks and what phase-gather receives.
- `src/core/agents/registry.ts`, `assets/providers/{trackers,enrichments}/*.json`, and `assets/manifest.json` must stay aligned (the asset validator enforces this).

Do not treat this package as a standalone workflow engine. The extension supplies `/dev` command wiring, tools, hooks, schemas, validation, status, and telemetry; the skill and agent definitions supply the actual orchestration prompts and execution roles.

## Project Layout

- `src/` holds all TypeScript source code:
  - `src/core/` contains host-neutral ACCORD logic: config, command dispatch, work items, artifacts, brief construction, verification, queries, telemetry, and agent metadata.
  - `src/adapters/pi/` contains Pi-specific integration code. Pi APIs should not leak into `src/core/`.
  - `src/adapters/mcp/` exposes the same `dev_*` tools over stdio MCP.
  - `src/integrations/` contains provider/enrichment dependency metadata used by `phase-gather`.
- `assets/` contains packaged Pi install assets: skills, agent definitions, providers (trackers + enrichments, each as a `.md` playbook + `.json` sidecar), language profiles, and `manifest.json`.
- `scripts/install-pi-assets.ts` links bundled Pi assets into a host Pi config directory; it refuses to replace local modifications unless `--force` is supplied.
- `schemas/` is the source of truth for persisted artifacts and agent return packets. Update schemas, validated examples, and registry metadata together.
- `assets/lang-profiles/` contains default command profiles used by `/dev init`.
- `.tasks/` holds runtime work item state and usage logs; it is transient.
- `docs/dev/<ID>/` holds committed work artifacts such as `brief.md`, `spec.json`, `plan.json`, `verify.json`, and `verify.md`.
- `docs/*.md` (excluding `docs/dev/`) are the project documentation: `concepts.md`, `pipeline.md`, `artifacts.md`, `schemas.md`, `hooks-and-tools.md`, `packaged-assets.md`, `configuration.md`, `extending.md`, `file-structure.md`, `local-development.md`. README.md is the slim entry point and links to each.

## Development Notes

- Diagnostic logging is off by default (level `error`). Set `"log_level": "debug"` in the `## Dev Harness` JSON block, or export `ACCORD_LOG_LEVEL=debug`, to see all internal traces on stderr. Levels: `debug`, `info`, `warn`, `error`, `silent`.
- Use Bun for local execution: `bun test`, `bun run validate:schemas`, `bun run validate:assets`, `bun run check:types`, `bun run check:bundle`, and `bun run check:runtime`.
- Use `bun run install:pi-assets --dry-run` to preview linking bundled skills and agents into `~/.config/pi/agent`.
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
  "lint": "bun run validate:schemas && bun run validate:assets",
  "format": null,
  "tracker": {
    "type": "github"
  },
  "verification_commands": [
    "bun test",
    "bun run validate:schemas",
    "bun run validate:assets",
    "bun run check:types",
    "bun run check:bundle",
    "bun run check:runtime"
  ]
}
```
