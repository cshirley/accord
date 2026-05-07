# Local development

How to make a checked-out copy of this repository run as your live `/dev` extension inside pi.dev. This is the workflow for editing ACCORD itself and seeing your changes immediately, rather than installing a published version from npm.

## What gets linked

A working install needs **two** symlinks into `~/.config/pi/agent/`:

| Link | Target | Why |
|---|---|---|
| `~/.config/pi/agent/extensions/accord` → this repo | The extension entry point. Pi reads `package.json#pi.extensions` and loads `src/index.ts`, which registers the `/dev` command, the `dev_*` tools, and the lifecycle hooks. |
| `~/.config/pi/agent/{skills,agents,providers}/...` → assets in this repo | The prompt assets the extension references at runtime: the `accord` skill, the `phase-*` and `review-*` agents, and the tracker/enrichment provider playbooks. |

You create the first link manually. The second is created automatically by the extension itself on Pi startup (see [Auto-install](#auto-install) below); you only need to run `bun run install:pi-assets` manually if you've opted out or want to install before the first Pi launch.

## One-time setup

1. **Install dependencies and verify the package is healthy:**
   ```bash
   bun install
   npm run check
   ```

2. **Symlink the repo as a Pi extension** (only once per Pi config):
   ```bash
   ln -s "$(pwd)" ~/.config/pi/agent/extensions/accord
   ```
   The directory name (`accord`) is what shows up in Pi's extension list. Pick anything that doesn't collide with an existing entry in `~/.config/pi/agent/extensions/`.

3. **Start pi.dev.** The extension's `session_start` hook detects that no `~/.config/pi/agent/.accord-assets.json` exists, runs the installer in-process, and notifies:
   > *ACCORD: linked N bundled asset(s) (vX.Y.Z) — restart pi to activate.*

   The same install also seeds `~/.config/pi/agent/accord-config.json` — a JSONC stub with every supported field commented out and documented inline. Edit it whenever you want to set global `context_sources`, `providers`, or `asset_bootstrap.auto_install`. The seed step is idempotent: if the file already exists it's left untouched, so you can always recreate a fresh stub by deleting it and re-running `bun run install:pi-assets`.

4. **Restart pi.dev once more.** This time Pi's startup scan picks up the freshly linked skills/agents/providers and `/dev` is fully functional.

After this initial double-restart, the bootstrap is silent. It only re-links and re-notifies when the package version or the bundled manifest changes.

## Auto-install

The extension's bootstrap behaviour:

| State | Action | Notification |
|---|---|---|
| Metadata matches running package | silent no-op | none |
| No metadata file (first install) | install in-process | `info`: "linked N assets — restart pi" |
| Metadata stale (version or manifest changed) | re-install | `info`: "re-linked N assets — restart pi" |
| Metadata stale, install no-op (already correct) | reconcile metadata | none |
| Local modifications block the install | abort install for those paths | `warning`: "N file(s) blocked — run with `--force`" |
| Bundled `assets/manifest.json` missing | abort with diagnostic | `warning`: "cannot read bundled manifest — run `bun install`" |

### Opting out

You can disable auto-install (e.g. you maintain hand-edited copies under `~/.config/pi/agent/skills/accord/`) in two places. They resolve in this order — first defined wins:

| Source | Where | Notes |
|---|---|---|
| `ACCORD_AUTO_INSTALL_ASSETS` env var | shell / `~/.zshrc` | Accepts `false`/`0`/`no`/`off` (disable) and `true`/`1`/`yes`/`on` (enable). Set this for one-off overrides; takes precedence over the config file. |
| `asset_bootstrap.auto_install` | `~/.config/pi/agent/accord-config.json` (global only) | Boolean. Persists across shells without touching your shell rc. The project-level `## Dev Harness` block intentionally does **not** support this field — auto-install is a developer-machine concern. |
| (default) | — | Auto-install is **on**. |

Example global config:

```jsonc
// ~/.config/pi/agent/accord-config.json
{
  "asset_bootstrap": {
    "auto_install": false
  },
  "context_sources": [ /* ... */ ]
}
```

With auto-install disabled the bootstrap still detects drift and warns you, but never writes anything; the fix is to run `bun run install:pi-assets [--force]` manually.

## Manual install

You can always run the installer directly — handy if you want to preview, force-overwrite, or install before the first Pi launch:

```bash
bun run install:pi-assets --dry-run    # show what would change
bun run install:pi-assets              # link (skipping locally modified files)
bun run install:pi-assets --force      # overwrite locally modified files
```

The script writes `~/.config/pi/agent/.accord-assets.json` with the package version and manifest checksum and (the first time it runs into a fresh Pi config dir) seeds `~/.config/pi/agent/accord-config.json` with a commented-out template. The auto-install bootstrap reads the metadata file to decide whether work is needed, so manual and automatic installs interoperate cleanly.

## Verifying the install

Inside pi (after the second restart):

- `/dev help` — should print the ACCORD subcommand list.
- `/dev tasks` — should run without "command not found" and print an empty dashboard if you have no work items yet.
- The status bar should show the language and `$0.00` cost line as soon as a `## Dev Harness` block exists in the project's `AGENTS.md`.

If pi loads but `/dev` is missing, check:

- `ls -la ~/.config/pi/agent/extensions/accord` — confirm the symlink resolves to the repo.
- `cat ~/.config/pi/agent/extensions/accord/package.json | jq '.pi.extensions'` — should show `["./src/index.ts"]`.
- `ls ~/.config/pi/agent/skills/accord ~/.config/pi/agent/agents/accord ~/.config/pi/agent/providers` — all three should resolve.
- `cat ~/.config/pi/agent/.accord-assets.json` — confirms the bootstrap ran. If absent, the auto-install was either disabled (check `ACCORD_AUTO_INSTALL_ASSETS` and `asset_bootstrap.auto_install` in `~/.config/pi/agent/accord-config.json`) or failed silently — check the Pi notifications log.

## Edit-test loop

- TypeScript edits under `src/` take effect on the next pi session restart (Pi loads the extension from the symlinked source, so there's no rebuild step).
- Prompt edits under `assets/agents/` and `assets/providers/` take effect on the next subagent spawn (no Pi restart needed) because the agent bundle is symlinked.
- Skill edits under `assets/skills/accord/SKILL.md` take effect on the next `/skill:accord` invocation.
- Schema edits require running `node schemas/examples/validate-examples.mjs` (or `npm run check`) before they're trusted; the harness validates writes against the latest schemas at runtime, so a malformed schema will start blocking artifact writes immediately.

Run `npm run check` before any structural change you intend to keep — the suite covers tests, schemas, asset/manifest consistency, type-check, bundle, and a runtime smoke.

## Removing the install

```bash
rm ~/.config/pi/agent/extensions/accord
rm ~/.config/pi/agent/skills/accord
rm ~/.config/pi/agent/agents/accord
rm ~/.config/pi/agent/providers
rm ~/.config/pi/agent/.accord-assets.json   # optional metadata
```

Pi's own state under `~/.config/pi/agent/` (settings, sessions, auth) is untouched.

## Running over MCP instead

If you'd rather expose the same `dev_*` tools to a non-Pi MCP client (Cursor, Claude Desktop, etc.) without registering the extension at all:

```bash
ACCORD_CWD=/path/to/your/project bun run mcp
```

This serves the same tool surface over stdio MCP. The Pi-only event hooks (on-write schema validation, post-code verification, brief injection) don't run in this mode — wire equivalent behaviour into your client's hook system if you need it. See [`docs/hooks-and-tools.md`](hooks-and-tools.md) for the full hook list.
