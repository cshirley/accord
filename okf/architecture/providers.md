---
type: Architecture
title: Providers (trackers and enrichments)
description: Markdown fetch playbooks plus JSON connectivity sidecars that phase-gather uses to pull ticket and supplementary context.
tags: [providers, gather, jira, github, enrichment, mcp]
status: stable
generated: { by: agent:pi, at: 2026-09-28T16:41:59Z }
sources:
  - id: providers-dir
    resource: /packages/accord-assets/providers/
    title: Bundled providers
  - id: provider-schema
    resource: /packages/accord-core/schemas/provider-schema.json
    title: Provider sidecar schema
  - id: provider-deps
    resource: /packages/accord-core/src/integrations/provider-deps.ts
    title: Sidecar loader
  - id: extending
    resource: /docs/extending.md
    title: Extending
---

# Model

A provider = **playbook** (`<name>.md`, instructions for fetching) + **sidecar** (`<name>.json`,
connectivity: `mcpTools`, optional `cliFallback`, optional `envFallback`, `promptFile`).
Providers are not agents — no frontmatter, never spawned directly. `provider-deps.ts` loads
sidecars at runtime; there is no hardcoded dependency map.

| Kind | Bundled |
|------|---------|
| `trackers/` (primary ticket source) | `github`, `gitlab`, `jira`, `plain-text` |
| `enrichments/` (supplementary) | `confluence`, `figma`, `github-discussions`, `github-pr`, `google-docs`, `slack` |

# Gather preflight

Before `phase-gather` spawns, the harness merges bundled sidecars with project-declared
providers (`accord.json` → `providers[]`; same name overrides bundled), checks each is
reachable (MCP tool present, CLI fallback, or env var), prompts if unavailable (`-y`
auto-confirms headless), and injects a **Provider Playbooks** block with absolute playbook
paths into the gather brief. Tracker selection comes from Dev Harness `tracker.type`.

# Adding

See [Add a provider](/playbooks/add-a-provider.md).
