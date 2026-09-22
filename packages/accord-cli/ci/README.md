# CI seed configs

Templates for model-profile resolution on a fresh GitHub-hosted runner.

`.github/actions/setup-accord/action.yml` copies `subagent.json` into
`~/.config/pi/agent/` after `accord config init` has run, using `cp -n` so a
restored cache always wins over the template. The exec harness
(Claude Code by default) reads tier/model selection from this file via
`accord.json` harness backends.

## Files

| File | Reader | Effect when missing |
|---|---|---|
| `subagent.json` | Exec harness model resolution (`accord-cli` backends) | Falls back to in-code defaults (works, but loses tunable tier-per-phase model selection). |

## CI tuning rationale

The bundled template is tuned for a non-interactive Anthropic-only run:

- **Single provider** (`anthropic`). The autopipeline only wires
  `ANTHROPIC_API_KEY`, so the profile uses `provider: "anthropic"` with
  `thinkingMode: "flag"`.
- **Lower thinking levels** than a developer's local setup. CI runs are
  bounded by `max_cost_usd` (default $20).

## Selecting a profile via workflow input

The reusable workflow exposes a `subagent_profile` input (default
`anthropic-direct`). The `setup-accord` composite, after copying the seed
template, runs `jq` to set `activeProfile` to whatever the caller
requested. If the named profile is absent from the resulting JSON the
step fails fast with an `::error::` line listing the profiles it found.

## Consumer overrides (richer profile sets)

Consumers who want additional profiles commit their own `subagent.json`
into their repo and copy it over the seeded template **after** the
`setup-accord` action, **then** pass `subagent_profile: <their-profile>` to
the reusable workflow:

```yaml
- name: Override CI subagent profile
  shell: bash
  run: cp ci/subagent.json ~/.config/pi/agent/subagent.json
```

See `docs/ci/autopipeline.md#runtime-configs-and-profiles` for the full
walkthrough.
