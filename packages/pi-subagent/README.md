# subagent

Pi extension that registers a single **`subagent`** tool. Each invocation spawns a **separate `pi` child process** with a fresh context window, runs a named agent markdown definition to completion, and returns structured text (JSON mode) to the parent session.

## Why

Long harness runs (spec → plan → code → verify) blow up context if everything shares one window. Delegating phases or reviews to subagents keeps the parent transcript small while still using full agent prompts, tools, and model config per sub-task.

## Spawn API (host-neutral)

**`runSubagent()`** (exported from `src/api.ts`) is the programmatic entry point for ACCORD and other hosts (await + optional timeout + status events). **`spawnSubagent()`** is the lower-level child-process runner; the Pi `subagent` tool builds on `runSubagent()`.

Prefer explicit fields over name discovery:

| Field | Purpose |
|-------|---------|
| `agentFile` | Absolute path to agent `.md` (frontmatter + body) |
| `model` | Override model (`provider/model` or bare id + profile provider) |
| `thinking` | Override thinking level when supported |
| `task` | User/task prompt for the child |
| `systemAppend` | Markdown appended to the agent system prompt |
| `response` | Response contract (instruction, schema path, or embedded schema) |
| `timeoutMs` | Wall-clock limit (`runSubagent` only); aborts the child when exceeded. Omit to use `spawnTimeoutMs` from `subagent.json` or **30 minutes**. Pass **`0`** to disable (ACCORD orchestration does this). |
| `onEvent` | Callback for structured lifecycle events (`resolving`, `progress`, `tool_*`, `completed`, `failed`, …) |
| `signal` | Caller `AbortSignal` (combined with `timeoutMs`) |

ACCORD orchestration UI (status widgets, in-chat spawn rows) lives in `src/adapters/pi/` and calls `runSubagent()` from `api.ts` — not in this package.

## Modes

Exactly **one** mode per call:

| Mode | Parameters | Behaviour |
|------|--------------|-----------|
| **Single** | `agent` or `agentFile`, `task`, optional `cwd` | One child, one agent, one task |
| **Parallel** | `tasks: [{ agent, task, cwd? }, ...]` | Multiple children (bounded concurrency); results aggregated |
| **Chain** | `chain: [{ agent, task, cwd? }, ...]` | Sequential children; later `task` strings may include `{previous}` replaced with the prior step's output |

## Agent discovery

- **Default** (`agentScope: "user"`): agents under the user Pi config (e.g. `~/.pi/agent/agents`), same layout Pi uses elsewhere.
- **Project** (`"project"`): repo-local definitions (e.g. `.pi/agents`).
- **Both** (`"both"`): union of user + project; project agents can trigger a UI confirm when `confirmProjectAgents` is true (default).

Per-task **`cwd`** runs the child `pi` process with that working directory — use this with [worktree](../pi-worktree/README.md) paths for parallel branches.

## Configuration

Model and provider defaults for subagents are driven by **`subagent.json`** next to the discovered agent roots, with fallbacks documented in `src/agents.ts` (profiles, tiers, skill-namespace overrides, `agentProfiles` / `reviewProfile` for cross-vendor review). Agent markdown may pin a model in frontmatter.

## Limits (sensible defaults)

Parallel fan-out is capped (max tasks and concurrency are enforced in code) so a single orchestration step cannot fork unbounded processes.

## Installation

Bundled with the **`@clive.shirley/accord`** monorepo via root `package.json` → `pi.extensions` (this entry is registered **before** the ACCORD harness so orchestration skills can call `subagent` reliably).

To smoke-test the extension file alone:

```bash
pi -e "$(pwd)/packages/pi-subagent/src/index.ts"
```

## Architecture

See [`src/README.md`](src/README.md) for the module layout.

- **`src/api.ts`** — programmatic API for hosts (`runSubagent`, agents, progress). ACCORD imports from here only.
- **`src/index.ts`** — thin Pi extension entry; registers the `subagent` tool via `tool/`.
- **`src/spawn/`** — isolated child `pi` process, timeouts, lifecycle events.
- **`src/tool/`** — Pi tool execute/render (single, parallel, chain).
- **`src/progress/`** — streaming activity buffers and progress summaries.
- **`src/events/`** — parse JSON lines from the child process.

Orchestration UI (status widgets, in-chat rows) lives in the parent package under `src/adapters/pi/`, not here.
