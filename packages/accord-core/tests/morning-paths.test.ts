import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { morningConfigPath, morningStateDir } from "../src/morning/paths.js";

const KEYS = [
  "HOME",
  "XDG_CONFIG_HOME",
  "XDG_STATE_HOME",
  "MORNING_CONFIG_PATH",
  "MORNING_STATE_DIR",
];
let saved: Record<string, string | undefined>;
let home: string;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  home = mkdtempSync(join(tmpdir(), "morning-paths-"));
  process.env.HOME = home;
  for (const k of KEYS.slice(1)) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("morning paths", () => {
  it("defaults to XDG config and state", () => {
    expect(morningConfigPath()).toBe(join(home, ".config/accord/morning-briefing.json"));
    expect(morningStateDir()).toBe(join(home, ".local/state/accord"));
  });
  it("falls back to legacy config only when new file missing", () => {
    mkdirSync(join(home, ".pi/agent"), { recursive: true });
    const legacy = join(home, ".pi/agent/morning-briefing.json");
    writeFileSync(legacy, "{}");
    expect(morningConfigPath()).toBe(legacy);
    mkdirSync(join(home, ".config/accord"), { recursive: true });
    writeFileSync(join(home, ".config/accord/morning-briefing.json"), "{}");
    expect(morningConfigPath()).toBe(join(home, ".config/accord/morning-briefing.json"));
  });
  it("honours env overrides, ignoring blanks", () => {
    process.env.MORNING_CONFIG_PATH = "/x/c.json";
    process.env.MORNING_STATE_DIR = "/x/s";
    expect(morningConfigPath()).toBe("/x/c.json");
    expect(morningStateDir()).toBe("/x/s");
    process.env.MORNING_CONFIG_PATH = " ";
    expect(morningConfigPath()).toBe(join(home, ".config/accord/morning-briefing.json"));
  });
});
