# @clive.shirley/pi-skills

Standalone Pi skills for git workflow — **no ACCORD harness** (`/dev`, `dev_*`, work items).

| Skill | Needs |
| --- | --- |
| `commit`, `pr`, `verify`, `worktree`, `ci-debug` | **pi-git** |
| `review` | **pi-git** + **pi-subagent** + review agents (see install) |
| `session-retro` | Bun only (reads `~/.config/pi/agent/sessions`) |
| `crq-notify` | **pi-integrations** (Jira + Slack + GitHub tools) |

## Install (harness-free)

From the monorepo root:

```bash
bash scripts/install-pi-skills.sh
# optional: Jira/Slack for crq-notify
bash scripts/install-pi-skills.sh --integrations
```

This runs `pi install` on **pi-subagent**, **pi-git**, and **pi-skills** only — not `pi-accord`, not `accord` CLI, not full `install:assets` (providers, phase agents).

Review agents (`review-code`, `review-security`, `review-test`) are symlinked into `~/.config/pi/agent/agents/accord/` via:

```bash
bun packages/pi-skills/scripts/install-review-agents.ts --force
```

## Manual install

```bash
pi install /path/to/accord/packages/pi-subagent
pi install /path/to/accord/packages/pi-git
pi install /path/to/accord/packages/pi-skills
bun /path/to/accord/packages/pi-skills/scripts/install-review-agents.ts --force
```

## vs full ACCORD

| | `install-pi-skills.sh` | `install-dev.sh` (full) |
| --- | --- | --- |
| `/commit`, `/pr`, `/review`, `/verify`, … | yes | yes |
| `git_*`, `gh_*`, `repo_verify`, `wt_*` | yes | yes |
| `/dev`, `dev_*`, orchestration | no | yes |
| Phase agents, providers, `accord` CLI | no | yes |

Full monorepo `pi install` still loads everything; use the harness-free script when you only want workflow skills in other repos.
