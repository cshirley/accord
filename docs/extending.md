# Extending

## Adding a language

1. Create `packages/accord-assets/lang-profiles/<lang>.json`
2. Add marker to `MARKER_MAP` in `packages/accord-core/src/config/detect/index.ts`
3. Add `infer<Lang>Project` in `packages/accord-core/src/config/detect/index.ts`
4. Wire into the `switch` in `inferProjectConfig`

## Adding an agent

1. Create `packages/accord-assets/agents/accord/<name>.md` (frontmatter: name, description, tier, tools)
2. Create `packages/accord-core/schemas/return-schemas/<name>.json`
3. Create `packages/accord-core/schemas/examples/<name>.json` with example payloads
4. Register in `packages/accord-core/src/agents/registry.ts`
5. Add the agent to `packages/accord-assets/manifest.json`
6. Run `bun run validate:assets` and `node packages/accord-core/schemas/examples/validate-examples.mjs`

## Adding a provider or enrichment

### Bundled provider (ships with the package)

1. Create the fetch playbook at `packages/accord-assets/providers/trackers/<name>.md` (primary tracker) or `packages/accord-assets/providers/enrichments/<name>.md` (supplementary context).
2. Create the connectivity sidecar at the same path with `.json` (validated against `packages/accord-core/schemas/provider-schema.json`). Declare `mcpTools`, optional `cliFallback`, optional `envFallback`, and `promptFile: "<name>.md"`.
3. Add the provider name to `packages/accord-assets/manifest.json` under `assets.providers.trackers` or `assets.providers.enrichments`.
4. Run `bun run validate:assets`. The runtime loader picks the sidecar up automatically.

### User-supplied provider (project-local, no package edit)

1. Write a fetch playbook somewhere convenient (e.g. `~/.config/accord/providers/my-jira.md`).
2. Add an entry to your project's `accord.json` `providers` array:
   ```json
   {
     "providers": [
       {
         "name": "my-jira",
         "kind": "tracker",
         "label": "Internal Jira mirror",
         "mcpTools": ["mcp__internal__jira_get"],
         "cliFallback": null,
         "envFallback": "INTERNAL_JIRA_TOKEN",
         "promptFile": "~/.config/accord/providers/my-jira.md"
       }
     ],
     "tracker": { "type": "my-jira" }
   }
   ```
3. The next `phase-gather` run will preflight `my-jira`, inject the resolved playbook path into the agent's task, and use it instead of the bundled tracker. User-defined names override bundled ones with the same name.
