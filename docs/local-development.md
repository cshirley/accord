# Local development

How to make a checked-out copy of this repository run as your live `/dev` extension inside pi.dev. This is the workflow for editing ACCORD itself and seeing your changes immediately, rather than installing a published version from npm.

## What gets wired in

A working install needs **two** pieces under `~/.config/pi/agent/`:

| Piece | How | Why |
|---|---|---|
| **This repo as a Pi package** | Add the repo root to global `settings.json` → **`packages`** via **`pi install <path>`** (see [One-time setup](#one-time-setup)). Pi reads `package.json` → **`pi`** and loads **`pi.extensions`** (six modules: `packages/pi-subagent`, `packages/pi-worktree`, `packages/pi-thrift`, `packages/pi-git-tools`, `packages/pi-tools`, then `src/index.ts` for `/dev`, `dev_*` tools, hooks) plus **`pi.skills`** / **`pi.prompts`** / **`pi.themes`** from the checkout. Same manifest-driven behaviour as the old `extensions/accord` symlink, without linking into `extensions/`. |
| **`{skills,agents,providers}/...` → bundled assets** | The extension's auto-install (or `bun run install:assets`) | Agent/provider prompts and companion skills (`commit`, `pr`, `review`) the harness expects at runtime. |

You register the package once with the Pi CLI (or by editing `settings.json` yourself). The asset links are created automatically on Pi startup unless you opt out (see [Auto-install](#auto-install)); run `bun run install:assets` manually if you've opted out or want to install before the first Pi launch.

### Other local extensions

If you maintain additional Pi package checkouts (for example `guardrail/`, `journal/` trees with their own `package.json` + `pi` block), run **`pi install /path/to/each/root`** again (or edit `settings.json`). **`pi list`** shows configured sources. Keep using **`extensions/*.ts`** or **`extensions/<dir>/index.ts`** only for extensions that are *not* full packages.

## One-time setup

1. **Install dependencies and verify the package is healthy:**
   ```bash
   bun install
   npm run check
   ```

2. **Register this repo with the Pi CLI** (only once per Pi config). From the repo root:
   ```bash
   bun run install:dev
   ```
   Equivalent to **`pi install "$(pwd)"`** followed by **`bun run install:assets`**. To register other local Pi package checkouts first, run **`bash scripts/install-dev.sh /path/to/other-pkg …`** (each directory must contain `package.json`; this repo is always installed last). Or run **`pi install .`** and **`bun run install:assets`** by hand.
   This installs the local package and appends its path to **`~/.config/pi/agent/settings.json` → `packages`**. See **`pi install --help`** for flags (e.g. **`-l` / `--local`** writes `.pi/settings.json` in the current working directory instead of the global agent dir).

   Before starting Pi, ensure you are not loading the harness twice: if you still have a legacy **`~/.config/pi/agent/extensions/accord`** symlink (or separate **`extensions/subagent`**, **`worktree`**, … dirs), **remove them** so only the `packages` entry applies (this repo ships those sources under `packages/`).

3. **Start pi.dev.** The extension's `session_start` hook detects that no `~/.config/pi/agent/.accord-assets.json` exists, runs the installer in-process, and notifies:
   > *ACCORD: linked N bundled asset(s) (vX.Y.Z) — restart pi to activate.*

   The same install also seeds `~/.config/pi/agent/accord.json` — a JSONC stub with every supported field commented out and documented inline. Edit it whenever you want to set global `context_sources`, `providers`, or `asset_bootstrap.auto_install`. The seed step is idempotent: if the file already exists it's left untouched, so you can always recreate a fresh stub by deleting it and re-running `bun run install:assets`.

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

You can disable auto-install (e.g. you maintain hand-edited copies under `~/.config/pi/agent/skills/review/`) in two places. They resolve in this order — first defined wins:

| Source | Where | Notes |
|---|---|---|
| `ACCORD_AUTO_INSTALL_ASSETS` env var | shell / `~/.zshrc` | Accepts `false`/`0`/`no`/`off` (disable) and `true`/`1`/`yes`/`on` (enable). Set this for one-off overrides; takes precedence over the config file. |
| `asset_bootstrap.auto_install` | `~/.config/pi/agent/accord.json` (global only) | Boolean. Persists across shells without touching your shell rc. The project-level `## Dev Harness` block intentionally does **not** support this field — auto-install is a developer-machine concern. |
| (default) | — | Auto-install is **on**. |

Example global config:

```jsonc
// ~/.config/pi/agent/accord.json
{
  "asset_bootstrap": {
    "auto_install": false
  },
  "context_sources": [ /* ... */ ]
}
```

With auto-install disabled the bootstrap still detects drift and warns you, but never writes anything; the fix is to run `bun run install:assets [--force]` manually.

## Manual install

You can always run the installer directly — handy if you want to preview, force-overwrite, or install before the first Pi launch:

```bash
bun run install:assets --dry-run    # show what would change
bun run install:assets              # link (skipping locally modified files)
bun run install:assets --force      # overwrite locally modified files
```

The script writes `~/.config/pi/agent/.accord-assets.json` with the package version and manifest checksum and (the first time it runs into a fresh Pi config dir) seeds `~/.config/pi/agent/accord.json` with a commented-out template. The auto-install bootstrap reads the metadata file to decide whether work is needed, so manual and automatic installs interoperate cleanly.

## Verifying the install

Inside pi (after the second restart):

- `/dev help` — should print the ACCORD subcommand list.
- `/dev tasks` — should run without "command not found" and print an empty dashboard if you have no work items yet.
- The status bar should show the language and `$0.00` cost line as soon as a `## Dev Harness` block exists in the project's `AGENTS.md`.

If pi loads but `/dev` is missing, check:

- `jq '.packages' ~/.config/pi/agent/settings.json` — should include the **real path** to this checkout (and any other roots you added with further **`pi install`** runs). Plain strings are local package roots; `npm:…` entries are unrelated npm Pi packages.
- From the repo: `jq '.pi.extensions' package.json` — should list the six `./packages/.../src/index.ts` entries and `./src/index.ts`.
- `ls ~/.config/pi/agent/skills/{commit,pr,review} ~/.config/pi/agent/agents/accord ~/.config/pi/agent/providers` — should resolve (from auto-install / `install:assets`).
- `cat ~/.config/pi/agent/.accord-assets.json` — confirms the bootstrap ran. If absent, the auto-install was either disabled (check `ACCORD_AUTO_INSTALL_ASSETS` and `asset_bootstrap.auto_install` in `~/.config/pi/agent/accord.json`) or failed silently — check the Pi notifications log.

## Edit-test loop

- TypeScript edits under `src/` or `packages/` take effect on the next pi session restart (Pi loads extension modules from the registered checkout, so there's no rebuild step).
- Prompt edits under `assets/agents/` and `assets/providers/` take effect on the next subagent spawn (no Pi restart needed) once those assets are linked into your agent dir (symlinks from `install:assets`).
- Skill edits under `assets/skills/{commit,pr,review}/SKILL.md` take effect on the next skill invocation.
- Schema edits require running `node schemas/examples/validate-examples.mjs` (or `npm run check`) before they're trusted; the harness validates writes against the latest schemas at runtime, so a malformed schema will start blocking artifact writes immediately.

Run `npm run check` before any structural change you intend to keep — the suite covers tests, schemas, asset/manifest consistency, type-check, bundle, and a runtime smoke.

## Removing the install

Remove this repo from Pi's package list:

```bash
pi remove /absolute/path/to/this/checkout   # same string you passed to pi install; see pi remove --help
```

Alternatively edit **`~/.config/pi/agent/settings.json`** → **`packages`** by hand. Optionally remove legacy symlinks:

```bash
rm -f ~/.config/pi/agent/extensions/accord
```

Then remove linked assets if you no longer need them:

```bash
rm ~/.config/pi/agent/skills/{commit,pr,review}
rm -r ~/.config/pi/agent/agents/accord
rm ~/.config/pi/agent/providers
rm ~/.config/pi/agent/.accord-assets.json   # optional metadata
```

Pi's own state under `~/.config/pi/agent/` (other settings keys, sessions, auth) is untouched except for the `packages` entry `pi remove` dropped.

## Running over MCP instead

If you'd rather expose the same `dev_*` tools to a non-Pi MCP client (Cursor, Claude Desktop, etc.) without registering the extension at all:

```bash
ACCORD_CWD=/path/to/your/project bun run mcp
```

This serves the same tool surface over stdio MCP. The Pi-only event hooks (on-write schema validation, post-code verification, brief injection) don't run in this mode — wire equivalent behaviour into your client's hook system if you need it. See [`docs/hooks-and-tools.md`](hooks-and-tools.md) for the full hook list.
