# Artifacts and work item IDs

## Artifact layout

Committed artifacts — one directory per work item:

```mermaid
flowchart TB
  subgraph dev["docs/dev/(work-item-id)/"]
    brief["brief.md — phase-align"]
    spec["spec.json — phase-spec (contract)"]
    specmd["spec.md — generated from spec.json"]
    plan["plan.json — phase-plan"]
    vjson["verify.json — phase-verify"]
    vmd["verify.md — dev_verify_summary"]
  end
```

Transient state — gitignored:

```mermaid
flowchart TB
  subgraph tasks[".tasks/"]
    wi["(id).json — work item state"]
    cp["(id)-checkpoint.json — multi-turn drafts"]
    tk["(id)-task-N.json — per-task ownership"]
    en["(id)-enrichments/ — gather cache"]
    us["(id)-usage.jsonl — subagent usage"]
  end
```

See [`docs/schemas.md`](schemas.md) for the JSON schema each file is validated against.

`spec.md` is **derived** from `spec.json` (including optional `diagrams[]` Mermaid blocks). The harness regenerates it whenever `spec.json` is validated under `docs/dev/<ID>/`. Edit `spec.json` only.

## Work item IDs

Pattern: `^[A-Z]+(-[A-Z]+)*-\d+$`

- Ticket-based: `ACCORD-1234`, `BUG-42`
- No-ticket (keyword slug): `AUTH-REFRESH-1`, `ADD-DARK-MODE-1`
