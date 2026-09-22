# @clive.shirley/pi-skills

Standalone Pi skills for git workflow and integrations. They ship with the ACCORD monorepo but are **not** part of the ACCORD harness or `install:assets` symlink bundle.

## Skills

| Skill | Purpose |
| --- | --- |
| `commit` | Stage and commit via `pi-git` (`git_commit_*`) |
| `pr` | Push and open/update PR via `pi-git` (`gh_pr_*`) |
| `review` | Standalone diff review via `pi-git` + `pi-subagent` |
| `crq-notify` | Jira CRQ → Slack release summary (integrations tools) |

## Install

From the monorepo root (loads skills with extensions):

```bash
pi install /path/to/accord
```

Or install this package alone:

```bash
pi install /path/to/accord/packages/pi-skills
```

Requires `pi-git` (and `pi-subagent` for `review`) from the same monorepo or your own Pi setup.

Agents for `review` still come from `bun run install:assets` (ACCORD agents) or your agent dir.
