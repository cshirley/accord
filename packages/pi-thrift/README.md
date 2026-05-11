# thrift

A [pi](https://pi.dev) extension that reduces token usage on **both sides** of
the conversation — fewer tokens in, fewer tokens out. Cache-aware: monotonic
stubbing keeps the prefix byte-identical within the provider's prompt-cache
TTL window so cache hits compound.

> Renamed from `token-pruner`. Legacy config at `~/.pi/agent/token-pruner.json`
> is auto-migrated on first load.

## How it works

```
                    ┌─────────────────────┐
  Tool results ───▶ │  input.ts           │ ───▶  Smaller context sent to LLM
  (bash, read, …)   │  • truncate at source│
                    │  • stub old turns    │
                    └─────────────────────┘

                    ┌─────────────────────┐
  LLM responses ◀── │  output.ts          │ ◀───  Terse system-prompt injection
                    │  • drop filler words │
                    │  • fragments OK      │
                    └─────────────────────┘
```

| Module | Target | Mechanism | Typical saving |
|--------|--------|-----------|----------------|
| `input.ts` | Input tokens | `tool_result` + `context` hooks | 60–80% of tool output |
| `output.ts` | Output tokens | `before_agent_start` system prompt | ~75% of response text |

## Installation

When developing this repo, thrift is loaded via `@clive.shirley/pi-accord` (`package.json` → `pi.extensions`).

To test the thrift entry file in isolation:

```bash
pi -e "$(pwd)/packages/pi-thrift/src/index.ts"
```

## Commands

All commands live under `/thrift` (alias `/tp`):

```
/tp                     Quick status overview
/tp on|off              Enable or disable the entire extension
/tp stats               Pruning statistics for this session
/tp output [level]      Set output compression (toggle if no arg)
/tp input [on|off]      Toggle input pruning (toggle if no arg)
/tp ttl [arg]           Inspect/control cache-aware TTL
/tp config              Interactive settings dialog
```

Tab-completion works at both the subcommand and argument level.

## Input pruning (`input.ts`)

### Strategy A — truncate at source (`tool_result` hook)

When a tool result exceeds the configured byte limit, it is truncated
**before** being stored in the session.  The truncation is permanent — the
oversized output never enters the context window.

| Tool | Default limit | Truncation direction |
|------|---------------|---------------------|
| `bash` | 10 KB | **Tail** — keeps exit codes, errors, final output |
| `read` | 40 KB | **Head** — keeps imports, declarations, file start |
| `grep` | 5 KB | **Head** — keeps first matches |
| `find` | 5 KB | **Head** — keeps first results |
| `ls` | 5 KB | **Head** — keeps first entries |

A notice is appended so the LLM knows output was trimmed:

```
[thrift: 120/2400 lines (5.0KB/48.2KB). 2280 lines (43.2KB) omitted.]
```

For `read` results, the notice also includes an instruction to re-read with
`offset`/`limit` before editing beyond the truncation point — preventing
`edit` failures from stale/missing content.

Error results (`isError: true`) are never truncated — the LLM needs full
diagnostics.

### Strategy B — stub old turns (`context` hook)

Before each LLM call, tool results from turns older than `keepRecentTurns`
(default **3**) are replaced with compact one-line stubs:

```
[bash output — 150 lines, pruned from older turn]
```

This runs on a deep copy of the messages — the stored session is unchanged.
Only `toolResult` messages for the configured tools are affected; user,
assistant, compaction summaries, and branch summaries are left alone.

**Turn counting:** walks backwards from the newest message. Each user message
increments the counter. Once `keepRecentTurns` user messages have been passed,
everything before that cutoff is eligible for stubbing.

Results smaller than `stubThresholdBytes` (default 200) are left as-is.

### Why both strategies together

| Strategy alone | Catches | Misses |
|----------------|---------|--------|
| A (truncate at source) | Oversized individual results | Reasonable results that accumulate over many turns |
| B (stub old turns) | Accumulated stale output | Current-turn results that are needlessly large |
| **A + B** | Both | — |

### Cache awareness (`cacheAware: true`, default on)

Naive strategy B re-stubs older turns on every call — which mutates the
request prefix and **invalidates the provider's prompt cache** the moment
a turn transitions from "recent" to "old". On a long session this means
you pay full input pricing every turn instead of cache-hit pricing.

With `cacheAware` enabled, stubbing decisions become **monotonic within
the cache TTL window**:

```
 turn 1   turn 2   turn 3   ... turn 7    (within 5min)
  full     full     full         full      ← cache hits compound

               —— TTL elapses (>5min idle) ——

 turn 8                                     (after the gap)
  stub stub stub kept kept kept full        ← free to re-prune; cache was dead anyway
```

Mechanism:

1. Every outgoing LLM request stamps `lastRequestTime`.
2. The active provider's TTL is looked up in `providerTTLs` (or
   `defaultTTL` as fallback).
3. On the `context` hook:
   - **Cache warm** (`now - lastRequestTime < TTL`): every prior
     stub/keep decision is replayed verbatim. Only newly added tool
     results get a fresh decision via the `keepRecentTurns` rule.
     The historical prefix bytes are byte-identical to the previous
     call → max cache hit.
   - **Cache cold** (TTL elapsed, provider switched, or first call):
     the decision map is wiped and the standard `keepRecentTurns` rule
     is applied from scratch. Cache was dead anyway, so being
     aggressive costs nothing.
4. `model_select` clears the decision map (the new provider has its
   own empty cache).

Default TTLs (milliseconds):

| Provider | TTL | Notes |
|----------|-----|-------|
| `anthropic` | 5 min | Standard ephemeral prompt cache |
| `openai` | 10 min | Sliding cached-input window |
| `openrouter` | 5 min | Varies by underlying model |
| `google`, `groq`, `cerebras`, `xai` | 0 | No stable cache TTL → cache-aware effectively off |
| (anything else) | `defaultTTL` (5 min) | |

Footer glyph (when `showStatus` is on):

- `🔥` cache warm — sticky decisions, prefix preserved
- `❄`  cache cold — fresh pruning pass

### Manual control

```
/tp ttl              Show provider, TTL, time-since-last-req, sticky-decision count
/tp ttl on|off       Toggle cache-aware monotonic stubbing
/tp ttl 5m|30s|1h|0  Override defaultTTL (0 disables cache-aware globally)
/tp ttl reset        Clear sticky decisions and lastRequestTime
```

## Output pruning (`output.ts`)

Injects a system-prompt fragment via `before_agent_start` that instructs the
LLM to maximise information density.  Inspired by
[pi-caveman](https://github.com/jonjonrankin/pi-caveman) by @jonjonrankin.

### Levels

| Level | Style | Example |
|-------|-------|---------|
| `off` | Normal verbosity | *"Sure! I'd be happy to help. The issue is likely caused by…"* |
| `lite` | Professional, no fluff. Full sentences. | *"Component re-renders because a new object reference is created each render."* |
| `full` | Drop articles, fragments OK. | *"New object ref each render. Inline prop = new ref = re-render."* |
| `ultra` | Abbreviations, arrows for causality. | *"Inline obj prop → new ref → re-render. `useMemo`."* |

### Safety guardrails

The prompt includes an auto-clarity rule: the LLM temporarily drops terse mode
for security warnings, irreversible-action confirmations, or when the user
appears confused.  It resumes after.

Code, commands, file paths, error messages, and config values are never
compressed — only natural-language explanations.

## Configuration

Settings persist to `~/.pi/agent/thrift.json`:

```jsonc
{
  "enabled": true,                 // master switch — false disables all pruning
  "input": {
    "enabled": true,
    "maxResultBytes": {
      "bash": 10000,
      "read": 20000,
      "grep": 5000,
      "find": 5000,
      "ls": 5000
    },
    "maxResultLines": 500,
    "keepRecentTurns": 3,
    "stubThresholdBytes": 200,
    "cacheAware": true,
    "providerTTLs": {
      "anthropic": 300000,
      "openai": 600000,
      "openrouter": 300000,
      "google": 0,
      "groq": 0,
      "cerebras": 0,
      "xai": 0,
      "local-openai": 0
    },
    "defaultTTL": 300000
  },
  "output": {
    "level": "full"          // default for new sessions
  },
  "showStatus": true         // footer status indicators
}
```

The output level is also persisted **per-session** via `pi.appendEntry()`, so
resuming a session restores the level it was using.  The config file sets the
default for *new* sessions.

### Interactive config

`/tp config` opens a dialog to change the default output level and toggle
status indicators.  Changes are saved immediately.

For input limits, edit the JSON file directly and `/reload`.

## Status indicators

When `showStatus` is enabled, two footer indicators show:

- **`✂ 15.2KB truncated, 5 stubs`** — input pruning activity
- **`🔥 terse FULL`** — output compression level (animated while the agent is working)

## File structure

```
packages/pi-thrift/
├── src/index.ts    Barrel — loads config, wires modules, registers /tp commands
├── src/config.ts   Shared types, defaults, load/save (→ thrift.json)
├── src/input.ts    Input pruning: tool_result + context hooks
├── src/output.ts   Output pruning: system-prompt injection + config dialog
└── README.md       This file
```

## Credits

Output pruning is based on [pi-caveman](https://github.com/jonjonrankin/pi-caveman)
by [@jonjonrankin](https://github.com/jonjonrankin), which itself draws from
[caveman](https://github.com/JuliusBrussee/caveman) by Julius Brussee.
