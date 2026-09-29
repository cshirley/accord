---
type: Playbook
title: Add a provider or enrichment
description: Ship a new bundled tracker/enrichment or declare a project-local one without editing the package.
tags: [providers, gather, extending]
status: stable
generated: { by: agent:pi, at: 2026-09-28T16:41:59Z }
sources:
  - id: extending
    resource: /docs/extending.md
    title: Extending
  - id: provider-schema
    resource: /packages/accord-core/schemas/provider-schema.json
    title: Provider sidecar schema
---

# Bundled

1. Playbook: `packages/accord-assets/providers/{trackers|enrichments}/<name>.md`.
2. Sidecar alongside: `<name>.json` with `mcpTools`, optional `cliFallback`, optional `envFallback`, `promptFile: "<name>.md"`.
3. Add name to `packages/accord-assets/manifest.json` under `assets.providers.trackers` or `.enrichments`.
4. `bun run validate:assets`. No TS changes — the loader discovers sidecars.

# Project-local

1. Write the playbook, e.g. `~/.config/accord/providers/my-jira.md`.
2. Add to the Dev Harness / `accord.json` `providers[]`:

   ```json
   {
     "providers": [{
       "name": "my-jira", "kind": "tracker", "label": "Internal Jira mirror",
       "mcpTools": ["mcp__internal__jira_get"], "cliFallback": null,
       "envFallback": "INTERNAL_JIRA_TOKEN",
       "promptFile": "~/.config/accord/providers/my-jira.md"
     }],
     "tracker": { "type": "my-jira" }
   }
   ```

3. Next `phase-gather` preflights it and injects the playbook path. Same name overrides a bundled provider.
