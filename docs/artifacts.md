# Artifacts and work item IDs

## Artifact layout

Committed artifacts — one directory per work item:

```
docs/dev/<ID>/
├── brief.md       Problem brief (phase-align)
├── spec.json      Specification (phase-spec)
├── plan.json      Implementation plan (phase-plan)
├── verify.json    Machine-readable verification report (phase-verify)
└── verify.md      Human-readable verification report (dev_verify_summary)
```

Transient state — gitignored:

```
.tasks/
├── <ID>.json                Work item (phase, decisions, deviations, cost)
├── <ID>-checkpoint.json     Multi-turn state (draft, answered, pending)
├── <ID>-task-N.json         Per-task file (phase-test/phase-code ownership)
├── <ID>-enrichments/        Gather cache (Slack, Confluence, Google Docs)
└── <ID>-usage.jsonl         Per-subagent token/cost tracking
```

See [`docs/schemas.md`](schemas.md) for the JSON schema each file is validated against.

## Work item IDs

Pattern: `^[A-Z]+(-[A-Z]+)*-\d+$`

- Ticket-based: `ACCORD-1234`, `BUG-42`
- No-ticket (keyword slug): `AUTH-REFRESH-1`, `ADD-DARK-MODE-1`
