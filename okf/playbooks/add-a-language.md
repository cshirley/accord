---
type: Playbook
title: Add a language
description: Teach /dev init to detect a new stack and infer its commands.
tags: [languages, init, detect, extending]
status: stable
generated: { by: agent:pi, at: 2026-09-28T16:41:59Z }
sources:
  - id: extending
    resource: /docs/extending.md
    title: Extending
  - id: detect
    resource: /packages/accord-core/src/config/detect/index.ts
    title: Stack detection
---

# Steps

1. Create `packages/accord-assets/lang-profiles/<lang>.json` (default test/type_check/lint/format commands).
2. Add the marker file to `MARKER_MAP` in `packages/accord-core/src/config/detect/index.ts`.
3. Implement `infer<Lang>Project` in the same file.
4. Wire it into the `switch` in `inferProjectConfig`.
5. Run `bun run validate:assets` and `bun test`.
6. Update the stacks table in [Dev Harness config](/references/dev-harness-config.md) and `docs/configuration.md`.
