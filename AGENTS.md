# ACCORD

`@clive.shirley/accord` is a Bun-workspaces monorepo for **ACCORD**, an agentic delivery harness: agree the work, persist it as schema-validated artifacts (brief → spec → plan → verify), route isolated phase/review agents, and verify evidence before handoff. It ships the Pi `/dev` command (`packages/pi-accord`), the headless `accord` CLI, the `accord-mcp` stdio server, a GitHub Actions autopipeline, and companion Pi extensions (`pi-subagent`, `pi-git`, `pi-thrift`, `pi-integrations`, `pi-skills`). One `pi install <repo>` registers all of them.

This file is loaded into every session, so it holds only what always applies. Everything else lives in the OKF bundle.

## Knowledge source: OKF bundle

The repo documents itself as an [Open Knowledge Format (OKF) v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) bundle in **`okf/`**; long-form narrative stays in `docs/`. Use progressive disclosure — do not load the whole bundle:

1. **Orient** — [`okf/index.md`](okf/index.md).
2. **Route** — design/code → [`okf/architecture/index.md`](okf/architecture/index.md); commands, config, env, schemas → [`okf/references/index.md`](okf/references/index.md); procedures → [`okf/playbooks/index.md`](okf/playbooks/index.md).
3. **Read** only the concepts you need. Concept IDs are bundle-relative paths without `.md` (e.g. `architecture/orchestration`); bundle-relative links (`/architecture/hooks.md`) resolve against `okf/`.

| If the task is about… | Start here |
| --- | --- |
| Which package owns what; Pi manifest | `okf/architecture/monorepo-packages.md` |
| Routing, resume loop, post-result handlers | `okf/architecture/orchestration.md` |
| Phase/review agents, review scope matrix | `okf/architecture/agents.md` |
| Spawning, harness backends, return packets | `okf/architecture/subagent-spawning.md` |
| Hooks / schema enforcement | `okf/architecture/hooks.md` |
| Test↔review loop, verify, gaps | `okf/architecture/crucible-verification.md` |
| Trackers / enrichment providers | `okf/architecture/providers.md` |
| `dev_*` tools / MCP | `okf/architecture/tool-surface.md` |
| `/dev` subcommands; `accord` CLI | `okf/references/dev-command.md`, `okf/references/accord-cli.md` |
| `## Dev Harness` / `accord.json` keys | `okf/references/dev-harness-config.md` |
| Retry caps, blocked tasks, auto-chain, auto-commit | `okf/references/orchestration-policy.md`, `okf/playbooks/unblock-a-task.md` |
| `.tasks/` vs `docs/dev/`, `decisions[]` | `okf/references/artifacts-and-state.md`, `okf/playbooks/answer-decisions.md` |
| Env vars (log level, harness, timeouts) | `okf/references/environment-variables.md` |
| Local install / Pi setup | `okf/playbooks/local-development-setup.md` |
| Adding an agent / provider / language | `okf/playbooks/add-*.md` |

**Keeping it true:** source wins over the bundle. When you change a file listed in a concept's `sources`, re-check that concept, update it if needed, and append a dated entry to `okf/log.md` (append-only). `bun run validate:okf` checks frontmatter, `sources` paths, links, and index reachability.

## Always-on rules

- **Layering:** orchestration and domain logic go in `packages/accord-core` (host-neutral). `pi-accord`, `accord-cli`, and `accord-mcp` are thin adapters — Pi APIs never enter `accord-core`.
- **Git / PR / review:** use `pi-git` tools (`git_commit_context`/`git_commit_execute`, `gh_pr_*`, `git_review_context`) or the `/commit`, `/pr`, `/review` skills — never bash `git add`/`git commit`/`gh pr create`. In Cursor they are often bridged as `mcp_pi_git_*`; call by full name, don't discover via shell. `accord-mcp` exposes only `dev_*` tools.
- **Delegation:** call the `subagent` tool (`agent` + `task`); don't read `packages/pi-subagent/README.md` to execute.
- **RGR:** `phase-test` owns tests, `phase-code` owns production code and never edits tests (violations respawn `phase-test`). Every adversarial loop is capped (default 3); a blocked task halts its work item until `/dev unblock`.
- **Alignment is enforced:** agents, providers, and schemas must stay aligned across `packages/accord-assets/manifest.json`, `packages/accord-core/src/agents/registry.ts`, and `packages/accord-core/schemas/` — follow the matching `okf/playbooks/add-*.md`; `validate:assets` / `validate:schemas` fail otherwise.
- **Preserve `## Dev Harness`** below — the harness reads its fenced JSON at runtime.

## Code conventions

- `const` over `let` unless reassigned; descriptive loop/index names (`commentIndex`, not `i`) except trivial numeric ranges.
- Biome (`biome.json`) is the formatter + linter. Fix only what you touched (`bunx biome check --write <files>`); `bun run check:biome:fix` rewrites the whole repo.
- Diagnostic logging defaults to `error`; `ACCORD_LOG_LEVEL=debug` (or `"log_level"` below) for traces.

## Verify before commit

`bun run check` runs everything in `verification_commands` below. Changes under `packages/accord-ci/` also need `docs/ci/pre-merge-smoke.md`. See `okf/playbooks/verify-a-change.md`.

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
  "lint": "bun run check:biome && bun run validate:schemas && bun run validate:assets && bun run validate:okf",
  "format": null,
  "tracker": {
    "type": "github"
  },
  "verification_commands": [
    "bun test",
    "bun run check:biome",
    "bun run validate:schemas",
    "bun run validate:assets",
    "bun run validate:okf",
    "bun run check:types",
    "bun run check:bundle",
    "bun run check:runtime"
  ]
}
```
