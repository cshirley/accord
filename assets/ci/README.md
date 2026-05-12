# CI seed configs

Templates for files that `pi-coding-agent` and bundled Pi extensions normally
write into `~/.config/pi/agent/` (or `~/.pi/agent/`) on a local machine but
which **do not exist on a fresh GitHub-hosted runner**.

`.github/actions/setup-pi/action.yml` copies these into the runner's agent
directory after `pi install pi-accord` has run, using `cp -n` so a restored
cache always wins over the template.

## Files

| File | Reader | Effect when missing |
|---|---|---|
| `subagent.json` | `packages/pi-subagent/src/agents.ts` | Falls back to in-code `DEFAULT_CONFIG` (works, but loses skill-namespace overrides and tunable tier-per-phase model selection). |
| `thrift.json` | `packages/pi-thrift/src/config.ts` | Loads `DEFAULT_CONFIG` from code (`output.level: "full"`, `showStatus: true`). CI prefers `"lite"` with status off. |

## CI tuning rationale

Both files are deliberately tuned for a non-interactive Anthropic-only run:

- **Single provider** (`anthropic`). The autopipeline only wires
  `ANTHROPIC_API_KEY`, so the profile uses `provider: "anthropic"` with
  `thinkingMode: "flag"`. There is no `cursor-agent` or `openai` profile to
  swap to — keep the file minimal so a missing key never silently routes to
  a profile that cannot authenticate.
- **Lower thinking levels** than a developer's local setup. CI runs are
  bounded by `max_cost_usd` (default $20). High-thinking Opus burns that
  budget on a single phase; `medium`/`low`/`off` keeps phases within budget
  for typical autopipeline tickets.
- **Output pruning at `lite`**. CI tool calls (`bun test`, `bun run
  validate:*`) emit kilobytes of output that the model rarely needs in full.
  `lite` keeps the head/tail (errors, exit codes) and stubs the middle.
- **`showStatus: false`**. There is no TTY footer to render in a runner.

## Selecting a profile via workflow input

The reusable workflow exposes a `subagent_profile` input (default
`anthropic-direct`). The `setup-pi` composite, after copying the seed
templates, runs `jq` to set `activeProfile` to whatever the caller
requested. If the named profile is absent from the resulting JSON the
step fails fast with an `::error::` line listing the profiles it found —
no silent fallback to in-code defaults.

## Consumer overrides (richer profile sets)

Consumers who want a profile set that the bundled template doesn't
ship (an `openai-direct` ladder, a `cursor-claude` mirror of a laptop
config, etc.) commit their own `subagent.json` into their repo
and copy it over the seeded template **after** the `setup-pi` action,
**then** pass `subagent_profile: <their-profile>` to the reusable
workflow:

```yaml
- name: Override CI subagent profile
  shell: bash
  run: cp ci/subagent.json ~/.config/pi/agent/subagent.json
```

The override file is mutated by `subagent_profile` exactly the same way
the bundled template is, so picking a non-default profile from a custom
file is the same one-line change at the workflow level. See
`docs/ci/autopipeline.md#runtime-configs-and-profiles` for the full
walkthrough.
