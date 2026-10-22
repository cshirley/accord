---
type: Playbook
title: Write in ASD-STE100 Simplified Technical English
description: Write procedures, warnings, and error messages in a controlled subset of ASD-STE100, and lint them with validate:ste.
tags: [documentation, style, ste, lint]
status: stable
style: ste
generated: { by: agent:pi, at: 2026-10-01T00:00:00Z }
sources:
  - id: ste-skill
    resource: /packages/pi-skills/skills/ste/SKILL.md
    title: ste skill (rules, word table)
  - id: ste-lint
    resource: /scripts/validate-ste.ts
    title: STE lint script
  - id: scripts
    resource: /package.json
    title: Root scripts (validate:ste)
---

# When to use

Use STE for text that a person follows or acts on. Examples: playbooks, procedures, warnings, error messages, and handoff notes. Do not use it for code, commands, or chat replies.

# Steps

1. Add `style: ste` to the frontmatter of the file.
2. Write each step as one imperative sentence of 25 words or fewer.
3. Write other sentences of 20 words or fewer. Keep each paragraph to 6 sentences or fewer.
4. Use the active voice and simple tenses. Keep the articles "the", "a", and "an".
5. Use "must" for a required action. Do not use `should` or `may`.
6. Put each WARNING or CAUTION line before the step that it applies to.
7. Run the linter:

```bash
bun run validate:ste
```

8. Fix each finding. The linter prints the file, the line, and the rule.

# Result

The linter prints `ste lint passed`. Files without `style: ste` are not checked.

# Limits

The linter checks a subset of the rules. It does not check the approved-word dictionary. A reviewer must read the text for meaning. The `ste` skill has the full word table.

# Related

Run `bun run check` to include this lint. See [Verify a change](/playbooks/verify-a-change.md).
