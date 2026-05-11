# Consumer quickstart — adopt the autopipeline in ten lines

Four artifacts are required to opt a repo into the ACCORD autopipeline.

## 1 — Wrapper workflow (10 lines)

Copy `examples/consumer-repo/.github/workflows/jira-autopipeline.yml` into
your repo at `.github/workflows/jira-autopipeline.yml`. The body delegates
to the reusable workflow:

```yaml
jobs:
  autopipeline:
    uses: cshirley/accord/.github/workflows/autopipeline.yml@v1
    with:
      ticket: ${{ inputs.ticket || github.event.client_payload.ticket }}
    secrets: inherit
```

(See the example file for the full version with optional inputs +
explicit secret pass-through.)

## 2 — Four required secrets

In your repository settings (Settings → Secrets and variables → Actions),
add:

| Secret | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic console API key. |
| `JIRA_BASE_URL` | `https://<your-instance>.atlassian.net` |
| `JIRA_USER_EMAIL` | Email of the Jira service account. |
| `JIRA_API_TOKEN` | API token from `https://id.atlassian.com/manage-profile/security/api-tokens`. |

Optionally also set `GH_PAT_PR` (PAT with `repo` scope) if you need
cross-repo PRs (forks etc.); same-repo workflows fall back to the
runner-provided `GITHUB_TOKEN`.

## 3 — AGENTS.md with a `## Dev Harness` block

The autopipeline's AGENTS.md gate (AC-2) reads the first fenced ```json
block inside `## Dev Harness`. Copy
`examples/consumer-repo/AGENTS.md` to your repo root and edit the JSON
block to reflect your stack:

- `test.command` is required (non-empty string).
- `type_check`, `lint`, `format` are optional strings or `null`.
- `verification_commands` is the command list that `phase-verify` runs.

## 4 — Atlassian Automation rule

Import `examples/consumer-repo/atlassian-automation-rule.json` via Jira
Settings → System → Automation → Import rules, then edit:

- `actor` → set to an Atlassian account that holds the GitHub PAT.
- The webhook URL `repos/<owner>/<repo>/dispatches` → your repo.
- The `Authorization` header → fill the GitHub PAT slot.

See `docs/ci/atlassian-automation.md` for the screenshot walkthrough.

## 5 — Verify

After all four artifacts are in place, transition a sample ticket to your
configured trigger status (default: `Ready for Autopilot`). You should
see a `ACCORD autopipeline (<TICKET>)` workflow start in your GitHub
Actions tab within ~10s.

If nothing happens, see `docs/ci/troubleshooting.md`.
