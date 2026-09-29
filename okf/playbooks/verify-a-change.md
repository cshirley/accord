---
type: Playbook
title: Verify a change to this repo
description: Run the Dev Harness verification suite for the ACCORD monorepo before committing or opening a PR.
tags: [verification, ci, biome, tests]
status: stable
generated: { by: agent:pi, at: 2026-09-28T16:41:59Z }
sources:
  - id: dev-harness-block
    resource: /AGENTS.md
    title: "## Dev Harness block (verification_commands, read at runtime)"
  - id: scripts
    resource: /package.json
    title: Root scripts (check, validate:*, check:*)
  - id: biome
    resource: /biome.json
    title: Biome config
  - id: contributing
    resource: /CONTRIBUTING.md
    title: Contributing
  - id: pre-merge
    resource: /docs/ci/pre-merge-smoke.md
    title: Pre-merge autopipeline smoke
---

# Steps

```bash
bun run check        # full suite
```

Or individually (matches `verification_commands`):

| Command | Checks |
|---------|--------|
| `bun test` | Unit + integration tests |
| `bun run check:biome` | Biome lint/format (`check:biome:fix` to apply) |
| `bun run validate:schemas` | Return-schema examples |
| `bun run validate:assets` | Agents ↔ registry ↔ schemas ↔ providers; skills ↔ `pi.skills` |
| `bun run validate:okf` | This bundle: frontmatter, `sources` paths, links, index reachability |
| `bun run check:types` | `tsc --noEmit` |
| `bun run check:bundle` | Bundle smoke build of `pi-accord` |
| `bun run check:runtime` | Runtime smoke script |

Changes under `packages/accord-ci/` or `.github/actions/setup-accord/`: also run
`bun test packages/accord-ci/tests` and follow `docs/ci/pre-merge-smoke.md` (L3 `act`, L4
`bun run smoke:gh:autopipeline` with `dry_run=true`).

# Conventions

- `const` over `let`; descriptive loop/index names.
- Commit/PR via `pi-git` tools (`git_commit_*`, `gh_pr_*`) or `/commit`, `/pr` skills — not raw bash.
- Update docs (and this bundle + [log](/log.md)) when user-visible behaviour, CLI, schemas, or CI contracts change. Changing a file listed in a concept's `sources` means re-checking that concept.
