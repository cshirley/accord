---
type: Playbook
title: Add or change an agent
description: Keep agent markdown, manifest, registry, return schema, and examples aligned when adding or changing a phase/review agent.
tags: [agents, extending, registry, schemas]
status: stable
generated: { by: agent:pi, at: 2026-09-28T16:41:59Z }
sources:
  - id: extending
    resource: /docs/extending.md
    title: Extending
  - id: agents-md
    resource: /AGENTS.md
    title: Development notes
  - id: validator
    resource: /packages/accord-assets/scripts/validate-assets.ts
    title: Asset validator
---

# Steps

1. Create/edit `packages/accord-assets/agents/accord/<name>.md` — frontmatter `name`, `description`, `tier`, `tools`; body = prompt. Review agents are read-only.
2. Add `packages/accord-core/schemas/return-schemas/<name>.json` (review agents reuse `review.json`). Include `stuck` shape (`question`, `context`, `tried?`) if the agent can escalate.
3. Add `packages/accord-core/schemas/examples/<name>.json` — array with one example per status.
4. Register in `packages/accord-core/src/agents/registry.ts` (`schemas`, `requiresConfig`, `verifyAfter`, `deferConfigGuard`).
5. Add to `packages/accord-assets/manifest.json`.
6. If orchestrated: add a post-result handler in `packages/accord-core/src/orchestration/post-result/` and wire routing in `resolve/`.
7. Validate:

   ```bash
   bun run validate:assets
   bun run validate:schemas
   bun test packages/accord-core/tests
   ```

# Notes

- Respect the review scope matrix ([Agents](/architecture/agents.md)); don't duplicate security or test-adequacy checks in `review-code`.
- Agents must not write `.tasks/` state — return `events[]` in the packet instead.
