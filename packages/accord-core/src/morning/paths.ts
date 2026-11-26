/**
 * Harness-neutral locations for morning-briefing config and runtime state.
 *
 * Config: $MORNING_CONFIG_PATH, else $XDG_CONFIG_HOME/accord/morning-briefing.json
 *   (default ~/.config/accord/), else the legacy ~/.pi/agent/morning-briefing.json
 *   when only that exists.
 * State:  $MORNING_STATE_DIR, else $XDG_STATE_HOME/accord (default ~/.local/state/accord).
 *   Holds the payload dump and the once-per-week email guard.
 */

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** HOME is read live so tests (and bun, which caches homedir()) can override it. */
const home = (): string => blank(process.env.HOME) ?? homedir();

const blank = (v: string | undefined): string | undefined => (v?.trim() ? v : undefined);

export function morningConfigPath(): string {
  const explicit = blank(process.env.MORNING_CONFIG_PATH);
  if (explicit) return explicit;
  const xdg = join(
    blank(process.env.XDG_CONFIG_HOME) ?? join(home(), ".config"),
    "accord",
    "morning-briefing.json",
  );
  const legacy = join(home(), ".pi", "agent", "morning-briefing.json");
  return !existsSync(xdg) && existsSync(legacy) ? legacy : xdg;
}

export function morningStateDir(): string {
  return (
    blank(process.env.MORNING_STATE_DIR) ??
    join(blank(process.env.XDG_STATE_HOME) ?? join(home(), ".local", "state"), "accord")
  );
}

/** Legacy state dir, read as a fallback so the weekly email guard survives migration. */
export function legacyMorningStateDir(): string {
  return join(home(), ".pi", "agent");
}
