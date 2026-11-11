---
name: risk-checklist
description: Run a structured risk review for a change, launch or research document — data and PHI/PII handling, jurisdiction and residency, security, failure modes, rollback, observability — and produce a risk register plus an executive go/no-go summary. Use when work touches health or personal data, a new region or partner, production rollout, or when the user asks what risks or gaps were missed.
---

# Risk checklist

Turn "what else are we missing?" into a repeatable pass over fixed domains, so completeness comes from the list and not from asking again. Output is a risk register and, when a decision is needed, a one-page summary a non-technical reader can act on.

Read [`checklist.md`](checklist.md) (this skill's directory) for the questions. It lists domains: data, jurisdiction and residency, security, correctness and identity, failure and degradation, delivery and rollback, observability, people and cost, open decisions.

## Process

1. **Scope.** State the change, the systems and the regions in one paragraph. Ask the user if any is unclear.
2. **Gather evidence before asking.** Read the code, config, infrastructure files, runbooks, existing risk documents and the brief (`docs/dev/<ID>/brief.md`). Check traces, logs or dashboards only if you have access. Do not ask the user things the repository answers.
3. **Walk each domain** in `checklist.md`. For every question that applies, write the answer with a source and a provenance tag: `[verified]` (checked, with source), `[inferred]`, or `[assumed]`. Mark a domain `n/a` with a reason when it does not apply.
4. **Raise risks.** Each gap or unverified answer becomes a register row. Do not hide an `[assumed]` answer: it is a risk by itself until confirmed.
5. **Rate.** Likelihood and impact use low / medium / high, with the reason in a few words. Rate the residual risk after the mitigation.
6. **Ask for the missing facts** in one batch of at most 5 questions, ordered by how much they change the rating. Wait for answers before finalising.
7. **Write the register** (below), then the summary if a decision is required.
8. **Ownership.** Every high or medium risk needs an owner and a date. Mark owners as `unassigned` when unknown. Never invent one.

## Register

```markdown
| ID | Domain | Risk | Likelihood | Impact | Mitigation | Residual | Owner | Status | Evidence |
|----|--------|------|-----------|--------|------------|----------|-------|--------|----------|
| R-1 | Data | PHI written to request logs | medium | high | redact at logger; add test | low | unassigned | open | `src/log.ts:40` [verified] |
```

Status values: `open`, `mitigated`, `accepted` (needs the name of who accepted it), `n/a`.

## Executive summary (when a go/no-go is needed)

Write for a reader who is not technical. Plain words, no jargon, at most one page.

```markdown
## Decision needed
<One sentence: what is being decided, by whom, by when.>

## Recommendation
GO | GO WITH CONDITIONS | NO-GO — <one-sentence reason>

## What could go wrong (top 3–5)
- <Risk in plain words> — <effect on patients, money or reputation> — <what reduces it>

## Conditions before go-live
- [ ] <Condition> — owner, date

## What we do not know yet
- <Unverified fact> — how and when it will be checked

## Rollback
<How we undo this, how long it takes, what is lost.>
```

The recommendation follows the register: any open high risk with an `unassigned` owner, or any critical `[assumed]` answer, means NO-GO or GO WITH CONDITIONS, never plain GO.

## Where to write

- With a brief: add the register under `docs/dev/<ID>/brief.md` (section *Security & Data* and *Infrastructure & Deployment*) or write `docs/dev/<ID>/risks.md` and link it.
- For research or launch documents: put it in the document, then run the `doc-verify` skill.

## Rules

- This skill supports a decision. It gives no legal advice. Regulation names in the checklist are prompts; compliance owners confirm what applies.
- Do not mark a risk `mitigated` without evidence the mitigation exists in the code, config or runbook.
- Do not drop a risk to keep the register short. Merge duplicates and keep the highest rating.
- Re-run after a significant change in scope, region, data or architecture, and say what changed.
