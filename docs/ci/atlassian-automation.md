# Atlassian Automation rule setup

The autopipeline is triggered by an Atlassian Automation rule that posts
a `repository_dispatch` to your GitHub repo whenever a ticket transitions
to the configured trigger status (default: `Ready for Autopilot`).

The canonical rule lives at
`examples/consumer-repo/atlassian-automation-rule.json` and can be
imported directly.

## Manual setup (if you prefer the UI)

1. Go to **Project settings → Automation** in Jira (or **Settings → System
   → Automation** for global rules).
2. Create a new rule with a **When → Issue transitioned** trigger.
   Configure `To status` = `Ready for Autopilot` (or your project's
   custom trigger status — must match `trigger_status` in your repo's
   `AGENTS.md` `## Dev Harness` block).
3. Add a **Then → Send web request** action:
   - **URL**:
     `https://api.github.com/repos/<owner>/<repo>/dispatches`
   - **Method**: `POST`
   - **Custom data**:
     ```json
     {
       "event_type": "accord-autopipeline",
       "client_payload": {
         "ticket": "{{issue.key}}",
         "status_at_trigger": "{{issue.status.name}}"
       }
     }
     ```
   - **Headers**:
     - `Authorization`: `Bearer <YOUR_GITHUB_PAT>`
     - `Accept`: `application/vnd.github+json`
     - `X-GitHub-Api-Version`: `2022-11-28`
4. Save and publish the rule.

## GitHub PAT scope

The PAT used in the `Authorization` header must have the **`repo`** scope
(or the fine-grained equivalent: `Contents: read/write`,
`Pull requests: read/write`, `Actions: write`).

This PAT is **not** `GH_PAT_PR`. It's a *Jira-side* secret used only to
fire the dispatch; the workflow's own GitHub auth uses the runner's
`GITHUB_TOKEN` (or the `GH_PAT_PR` secret if you've configured one for
cross-repo PRs).

## Verifying

After saving the rule, transition any test ticket to the trigger status.
You should see:

1. In Jira: the rule's audit log shows a `200` response from GitHub.
2. In GitHub: an `ACCORD autopipeline (<TICKET>)` workflow run appears in
   the Actions tab within ~10s.

If the rule's audit log shows `403` or `404`, the PAT is missing the
`repo` scope, has expired, or doesn't have access to the target repo.

If the rule fires but no workflow run appears, the repo's
`.github/workflows/jira-autopipeline.yml` is missing or the `event_type`
in the dispatch payload doesn't match the wrapper's
`repository_dispatch.types`.

See `docs/ci/troubleshooting.md` for the full diagnostic flow.
