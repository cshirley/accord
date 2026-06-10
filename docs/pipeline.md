# Pipeline and command flow

## Command flow

The `/dev` autocomplete and help output list subcommands in the order a developer usually calls them, favouring the happy path:

```mermaid
flowchart TD
    INIT["/dev init"] --> DESC["/dev <free text>"]
    DESC --> AGREE["/dev align ID<br/>/dev spec ID<br/>/dev plan ID"]
    AGREE --> RESUME["/dev resume ID"]
    RESUME --> FINISH["/dev finish ID"]
    FINISH --> COMPLETE["COMPLETE → /commit → /pr"]
    FINISH --> GAPS["GAPS → /dev gaps ID"]
    FINISH --> ND["NEEDS_DECISION → /dev review"]
    FINISH --> BLOCKED["BLOCKED → /dev resume ID"]
```

Optional: `/dev check <ID>` reruns lower-level acceptance checks without finalizing the work item.

The canonical subcommand order is:

```
init → align → spec → plan → resume → rehydrate → finish → check → gaps → review → deviations → amend-spec → spec-gaps → tasks → retro → tag → help
```

## Pipeline

The `implement/standard` pipeline. Hooks fire at marked points (`⚡`). Dotted lines are user-pause boundaries.

```mermaid
flowchart TD
    START(["/dev <free text>"]) --> ALIGN
    RESUME1(["/dev resume"]) -.-> ALIGN
    ALIGN["phase-align<br/>⚡ config guard<br/>⚡ schema inject"] --> ALIGN_DEC{return}
    ALIGN_DEC -.->|needs_input| PAUSE1[/"checkpoint (pause)"/]
    ALIGN_DEC -->|needs_gather| GATHER["⚡ gather preflight<br/>phase-gather"]
    ALIGN_DEC -->|"done → brief.md"| SPEC
    GATHER --> SPEC

    RESUME2(["/dev resume"]) -.-> SPEC
    SPEC["phase-spec<br/>⚡ config guard<br/>⚡ schema inject"] --> SPEC_DEC{return}
    SPEC_DEC -.->|needs_input| CP1[/"checkpoint"/]
    SPEC_DEC -->|"done → spec.json"| PLAN

    RESUME3(["/dev resume"]) -.-> PLAN
    PLAN["phase-plan<br/>⚡ config guard<br/>⚡ schema inject"] --> PLAN_DEC{return}
    PLAN_DEC -.->|needs_input| CP2[/"checkpoint"/]
    PLAN_DEC -->|"done → plan.json"| LOOP

    subgraph Loop["Code loop (per task)"]
        TEST["phase-test"] --> RT["review-test"]
        RT --> CODE["phase-code"]
        CODE --> POST["⚡ post-code verify<br/>type_check (hard gate)<br/>test (advisory)"]
        POST --> RC["review-code if needed"]
        RC --> MORE{more tasks?}
        MORE -->|yes| TEST
    end

    LOOP --> TEST
    MORE -->|no| FINISH["/dev finish ID<br/>review queue gate<br/>task completion gate<br/>⚡ verify preflight<br/>phase-verify-acceptance"]
    FINISH --> PACKET(["completion packet"])
    PACKET -->|COMPLETE| OUT1["/commit → /pr"]
    PACKET -->|GAPS| OUT2["/dev gaps ID"]
    PACKET -->|NEEDS_DECISION| OUT3["/dev review"]
    PACKET -->|BLOCKED| OUT4["/dev resume ID"]
```

### Quick fix (`quick_fix`)

For bounded, low-ceremony changes. Skips align, spec, and plan. When the test strategy is `new_red_test`, `phase-test` and `review-test` run before `phase-code` — preserving adversarial test/impl separation.

```mermaid
flowchart TD
    START(["/dev fix the login validation bug"]) --> INTENT["dev_intent → narrow_change<br/>dev_intent_enrich (if ticket)"]
    INTENT --> BOOT["dev_bootstrap<br/>pattern: quick_fix, phase: fixing"]
    BOOT --> BRIEF["dev_quick_fix_brief<br/>creates .tasks/ID-task-1<br/>writes stub spec + plan<br/>at docs/dev/ID/"]
    BRIEF --> STRAT{test strategy}
    STRAT -->|new_red_test| TEST["phase-test<br/>writes narrow regression test<br/>confirms RED"]
    STRAT -->|existing_tests / no_test| CODEBR
    TEST --> RT["review-test<br/>(pre-impl mode, has stub AC context)<br/>advisory — gated findings<br/>respawn phase-test (policy cap)"]
    RT --> CODEBR["dev_code_brief (reads stubs)"]
    CODEBR --> CODE["phase-code<br/>implements the fix → tests GREEN<br/>⚡ post-code verify<br/>type_check (hard gate)<br/>test (advisory)"]
    CODE --> PROMOTE["dev_promote_events (task_id: 1)"]
    PROMOTE -->|done| OUT1["COMPLETE → /commit → /pr"]
    PROMOTE -->|stuck| OUT2["stays fixing, decision packet"]
    PROMOTE -->|blocked| OUT3["decision packet"]
```

Single task only (`task_id: "1"`). Auto-generated spec/plan stubs give review agents AC coverage context without running the full spec/plan agents. The extension's post-code verification is the only hard gate.

### Express (`implement/express`)

For work that needs implementation rigour but not the full interview pipeline. Skips align, spec, and plan.

```mermaid
flowchart TD
    START(["/dev PROJ-123 quick one, no ceremony"]) --> INTENT["dev_intent → pipeline<br/>dev_intent_enrich (if ticket)"]
    INTENT --> BOOT["dev_bootstrap<br/>pattern: implement, variant: express<br/>phase: implementing"]
    BOOT --> GATHER["phase-gather<br/>context collection"]
    GATHER --> CODE["phase-code<br/>implement<br/>⚡ post-code verify<br/>type_check + test"]
    CODE --> VERIFY["post-code verify hook"]
    VERIFY --> RC["review-code if needed"]
    RC --> REPORT(["report → /commit → /pr"])
```

### Orchestrated (`implement/orchestrated`)

For tickets with 3+ parallelisable tasks. Same spec/plan as standard, but code runs in parallel worktrees.

```mermaid
flowchart TD
    START(["/dev PROJ-123 implement all subtasks in worktrees"]) --> AGREE["phase-align → phase-spec → phase-plan"]
    AGREE --> FAN[/Parallel code/]
    subgraph WT["Parallel code (one worktree per task)"]
        T1["task 1<br/>test → code"]
        T2["task 2<br/>test → code"]
        T3["task 3<br/>test → code"]
    end
    FAN --> T1
    FAN --> T2
    FAN --> T3
    T1 --> MERGE["Sequential merge into main branch"]
    T2 --> MERGE
    T3 --> MERGE
    MERGE --> FINISH(["/dev finish ID"])
```

### Investigate (`investigate`)

Read-only diagnosis first. Edits require confirmation.

```mermaid
flowchart LR
    START(["/dev why is the build failing"]) --> INTENT["dev_intent → investigate"]
    INTENT --> BOOT["dev_bootstrap<br/>pattern: investigate<br/>phase: gathering"]
    BOOT --> G["phase-gather"] --> E["phase-explore"] --> H["phase-hypothesise"] --> T["phase-test"] --> R(["report"])
```

### Infrastructure (`infra`)

For Terraform, Helm, Kubernetes, Pulumi, and CloudFormation work.

```mermaid
flowchart LR
    START(["/dev add the Redis Helm chart"]) --> BOOT["dev_bootstrap<br/>pattern: infra<br/>phase: exploring"]
    BOOT --> G["phase-gather"] --> E["phase-explore"] --> C["phase-code (IaC)"] --> V["phase-verify-infra"] --> R(["report"])
```

### Analyse (`analyse`)

For design docs, ADRs, and option comparisons. No code is produced.

```mermaid
flowchart LR
    START(["/dev write an ADR for the caching strategy"]) --> BOOT["dev_bootstrap<br/>pattern: analyse<br/>phase: researching"]
    BOOT --> G["phase-gather"] --> E["phase-explore"] --> D["draft (inline)"] --> RV["review-design"] --> R(["report"])
```

### Pattern selection

The orchestrator selects a pattern via `dev_intent` (keyword heuristics) optionally refined by `dev_intent_enrich` (ticket metadata):

| Cue | Pattern | Variant |
|-----|---------|--------|
| "add / implement / build / feature" with ticket | `implement` | `standard` |
| same but "quick one", "no ceremony" | `implement` | `express` |
| 3+ parallelisable tasks + worktrees requested | `implement` | `orchestrated` |
| "fix a typo / one-line / rename" or target path | `quick_fix` | — |
| "why / root cause / investigate" | `investigate` | — |
| Terraform / Helm / Kubernetes / Pulumi | `infra` | — |
| "ADR / design doc / compare options" | `analyse` | — |

When confidence is medium/low and a ticket ID is present, `dev_intent_enrich` fetches the ticket and can upgrade (`narrow_change` → `pipeline`) or downgrade (`pipeline` → `narrow_change`) based on AC count, story points, subtasks, and description length.

All pipelines share the same hooks. `/dev finish <ID>` is the developer-facing post-implementation command; `/dev check <ID>` is the lower-level acceptance verification step.

## Harness orchestration

The diagrams above reflect **current** behaviour: deterministic hooks plus the **core orchestrator** (`src/core/orchestration/`) driving `/dev` workflow subcommands via programmatic `subagent` spawns (default on; set `ACCORD_CORE_ORCHESTRATOR=0` to disable). The Pi adapter implements host ports (`spawnSubagent`, optional `runJudgment`) in `src/adapters/pi/subagent/`. See [`harness-orchestration.md`](harness-orchestration.md) for design rationale and [`harness-orchestration-implementation-plan.md`](harness-orchestration-implementation-plan.md) for delivery history. **Stdio MCP** consumers use the **`dev_orchestrate`** tool for the same `resolution` / `next_steps` JSON as Pi (without programmatic spawn or judgment LLM); see [`hooks-and-tools.md`](hooks-and-tools.md).
