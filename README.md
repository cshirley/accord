# ACCORD

Pi extension providing **ACCORD**: an agentic contract workflow for the `/dev` command. It handles project configuration, schema validation, verification gating, usage tracking, and status bar updates via transparent event hooks so agents stay focused on their task.

> **ACCORD**: **Agentic Contract for Collaborative Objectives, Requirements, and Rigorous Delivery**
> *Reach ACCORD before you build.*

The adversarial spec/plan-to-test subsystem is named **Crucible** — *where intent is stress-tested into evidence.*

> **Reach ACCORD. Enter the Crucible. Emerge with Oracles. Verify with Evidence.**

## What it does

- Takes a free-text request to `/dev` and routes it to the right pipeline (quick fix, full implement, investigate, infrastructure, analysis).
- Persists every step as a validated artifact (`brief.md`, `spec.json`, `plan.json`, `verify.json`) so review and verification agents have something concrete to work against.
- Runs preflight and post-step hooks (config guard, schema injection, gather/verify preflight, post-code verification, usage accounting) without the agent needing to know they exist.
- Bundles its own Pi skill, agent, and provider prompts; an installer links them into the host's config directory.

## Documentation

| Doc | Read this when you want to… |
|---|---|
| [`docs/accord-workflow.md`](docs/accord-workflow.md) | …get the single end-to-end overview of the harness: phases, agents, schemas, hooks, commands. Start here. |
| [`docs/accord-research.md`](docs/accord-research.md) | …understand *why* ACCORD is shaped the way it is — the principles, the design decisions that emerged in the build, and what got cut. |
| [`docs/concepts.md`](docs/concepts.md) | …understand the naming and the codebase shape (Core / Adapters / Crucible / Briefing / Harness). |
| [`docs/pipeline.md`](docs/pipeline.md) | …see the command flow and the per-pattern execution diagrams (standard, quick_fix, express, orchestrated, investigate, infra, analyse) plus pattern selection rules. |
| [`docs/artifacts.md`](docs/artifacts.md) | …know where work-item state and committed artifacts live on disk, plus the work-item-ID format. |
| [`docs/schemas.md`](docs/schemas.md) | …look up the JSON schema for any artifact or agent return packet. |
| [`docs/hooks-and-tools.md`](docs/hooks-and-tools.md) | …trace what runs at each Pi lifecycle event and which `dev_*` tools the harness exposes (also over stdio MCP). |
| [`docs/packaged-assets.md`](docs/packaged-assets.md) | …understand what ships in `assets/`, how the installer wires it in, and how the agent registry connects prompts to schemas. |
| [`docs/configuration.md`](docs/configuration.md) | …see how `/dev init` detects the project stack and what supported languages are inferred. |
| [`docs/extending.md`](docs/extending.md) | …add a language profile, a new agent, or a custom tracker/enrichment provider (bundled or per-project). |
| [`docs/file-structure.md`](docs/file-structure.md) | …navigate the source tree by responsibility. |
| [`docs/local-development.md`](docs/local-development.md) | …register this checked-out repo in Pi `settings.json` so `/dev` runs from your local source. |

For the dev-harness configuration this package itself uses (test/lint/verify commands), see [`AGENTS.md`](AGENTS.md).

## Quickstart

Inside the package:

```bash
bun install
npm run check                    # bun test + schemas + assets + types + bundle + runtime smoke
```

Make pi.dev load `/dev` from this checkout:

```bash
bun run install:pi-dev       # pi install this repo + link bundled assets (see scripts/pi-dev-install.sh)
# or: pi install .
# Start pi → it auto-links the bundled skills/agents/providers and
# notifies you to restart. Restart pi once more — done.
```

See [`docs/local-development.md`](docs/local-development.md) for the auto-install behaviour matrix, the opt-out env var, the edit-test loop, and how to remove the install.

Or expose the same `dev_*` tools over stdio MCP without registering as a Pi extension:

```bash
ACCORD_CWD=/path/to/your/repo bun run mcp
```

Inside a project that has the extension installed:

```bash
/dev init                        # detect stack, write ## Dev Harness block in AGENTS.md
/dev "ticket-or-free-text"       # let ACCORD route to the right pipeline
/dev finish <ID>                 # run verification and produce the completion packet
```
