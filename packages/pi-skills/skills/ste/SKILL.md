---
name: ste
description: "Write or rewrite procedures, warnings, error messages, playbooks, and handoff text in ASD-STE100 Simplified Technical English. Use when the user asks for STE, simplified English, unambiguous procedure text, or when editing a file marked `style: ste`."
---

# Simplified Technical English (ASD-STE100 subset)

Apply to **prose only**. Never change code, commands, paths, flags, identifiers, or quoted error output.

## Rules

| Area | Rule |
|------|------|
| Sentence length | ≤ 20 words. Procedure steps ≤ 25 words. |
| Paragraph | ≤ 6 sentences. One topic. |
| Steps | One action per step. Imperative, active voice: "Run `bun test`." |
| Voice | Active. Do not write "Tests are run by the harness." |
| Tense | Simple present, past, future only. No perfect or progressive forms. |
| Articles | Keep "the", "a", "an". Never drop them. |
| Words | One word, one meaning. Use plain verbs (table below). |
| Obligation | "must" = mandatory. "can" = possible. Do not use "should", "may", "might". |
| Nouns | Max 3 nouns in a row. Use "of" or "for" to break long strings. |
| Numbers | Numerals ("3 retries"). |
| Contractions | None. |
| Warnings | Put first, before the step. `WARNING:` = risk of injury or data loss. `CAUTION:` = risk of damage to a system. State the hazard and the way to avoid it. |

## Word choices

| Do not use | Use |
|------------|-----|
| utilize, leverage | use |
| initiate, commence | start |
| terminate | stop |
| verify, ensure | make sure, check |
| prior to | before |
| in order to | to |
| subsequently | then, after |
| approximately | about |
| failure to | if you do not |
| should | must (or rewrite) |

## Procedure

1. Write each step as one imperative sentence.
2. Put the result after the step: "The command prints `ok`."
3. Put WARNING or CAUTION lines before the step they apply to.
4. Run `bun run validate:ste` to lint files marked `style: ste`.

## Opt in

Add `style: ste` to the file frontmatter. The linter then checks the file.

## Rewrite example

Before: `You should utilize bun test prior to committing, as failing tests will be flagged by CI.`

After: `Run bun test before you commit. CI rejects a commit that has failing tests.`

## Limits

The official STE dictionary (about 900 approved words) is not bundled. The linter checks a subset: length, passive voice, banned words, contractions, progressive tense.
