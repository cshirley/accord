/**
 * Shared configuration — types, defaults, persistence.
 *
 * Settings are stored in ~/.pi/agent/thrift.json and survive across
 * sessions.  Both input.ts and output.ts receive the same config object by
 * reference, so runtime mutations (e.g. from the config dialog) are visible
 * to both modules immediately.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

// ── Output compression levels ───────────────────────────────────────────

export const OUTPUT_LEVELS = ["off", "lite", "full", "ultra"] as const;

export type OutputLevel = (typeof OUTPUT_LEVELS)[number];

export const STOP_ALIASES = new Set(["off", "stop", "quit"]);

// ── Config shape ────────────────────────────────────────────────────────

export interface ThriftConfig {
  /** Master switch — when false the entire extension is inert. */
  enabled: boolean;
  input: {
    enabled: boolean;
    /**
     * Size above which a tool result is reduced at source, per tool.
     *
     * These are reduction thresholds, not truncation limits: crossing one
     * triggers a structure-aware pass (code skeleton, log fold, list trim),
     * and the full output is preserved in the artifact store either way.
     */
    maxResultBytes: Record<string, number>;
    /** Hard line ceiling applied after reduction, as a backstop. */
    maxResultLines: number;
    /** Entries kept when trimming a grep/find/ls listing. */
    maxListEntries: number;
    /**
     * Apply structure-aware reducers. When false, oversized results fall back
     * to plain head/tail truncation — cruder, but predictable.
     */
    reduce: boolean;
    /** Tool results inside this many trailing turns are never stubbed. */
    keepRecentTurns: number;
    /** Results smaller than this are never stubbed (bytes). */
    stubThresholdBytes: number;
    /**
     * Context-pressure watermarks, as a percentage of the model's window.
     *
     * Nothing lossy happens below `lowWaterPercent`. Stubbing engages at
     * `highWaterPercent` and reclaims back down to the low mark in one pass.
     * The gap between them is deliberate: it batches pruning into occasional
     * large advances instead of nibbling every turn, so the provider's prompt
     * cache is invalidated rarely and each invalidation buys a lot of room.
     */
    lowWaterPercent: number;
    highWaterPercent: number;
    /** Minimum reclaimable share of the window before stubbing engages, so a
     *  cache invalidation is never spent on a trivial gain. */
    minReclaimPercent: number;
    /**
     * Window size assumed when the host exposes no usage API at all.
     *
     * Thrift then measures the conversation and runs the same watermarks
     * against this figure. Guessing low prunes earlier than necessary, which
     * costs a recall; guessing high prunes too late, which costs the request.
     * The default errs low for that reason.
     */
    assumedContextWindowTokens: number;
    /**
     * Keep stub decisions monotonic — once elided, a result is never restored.
     *
     * Prompt caches match on prefixes, so a decision that flips back and forth
     * invalidates the cache twice and changes what the model believes it has
     * already seen.
     */
    monotonic: boolean;
  };
  output: {
    /** Default output compression level for new sessions. "off" = disabled. */
    level: OutputLevel;
  };
  /** Show status indicators in the footer. */
  showStatus: boolean;
}

// ── Defaults ────────────────────────────────────────────────────────────

export const DEFAULT_CONFIG: ThriftConfig = {
  enabled: true,
  input: {
    enabled: true,
    maxResultBytes: {
      bash: 16_000,
      read: 48_000,
      grep: 8_000,
      find: 8_000,
      ls: 8_000,
    },
    // Matches pi's own built-in ceiling. The previous 500 made the line limit
    // bind long before any byte limit did, silently halving large reads.
    maxResultLines: 2_000,
    maxListEntries: 200,
    reduce: true,
    keepRecentTurns: 3,
    stubThresholdBytes: 400,
    lowWaterPercent: 55,
    highWaterPercent: 75,
    minReclaimPercent: 8,
    assumedContextWindowTokens: 128_000,
    monotonic: true,
  },
  output: {
    level: "full",
  },
  showStatus: true,
};

// ── Persistence ─────────────────────────────────────────────────────────

const CONFIG_PATH = join(homedir(), ".pi", "agent", "thrift.json");
let saveQueue: Promise<void> = Promise.resolve();

export async function loadConfig(): Promise<ThriftConfig> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    const parsed: unknown = JSON.parse(raw);
    const config = mergeConfig(DEFAULT_CONFIG, parsed) as ThriftConfig;
    if (!OUTPUT_LEVELS.includes(config.output.level)) {
      config.output.level = DEFAULT_CONFIG.output.level;
    }
    migrateLegacyKeys(parsed, config);
    return config;
  } catch {
    return structuredClone(DEFAULT_CONFIG);
  }
}

/**
 * Carry forward settings from the TTL-based cache scheme this replaced.
 *
 * `cacheAware` gated the same behaviour `monotonic` now gates, so a user who
 * turned it off should not silently get it back. The old `providerTTLs` and
 * `defaultTTL` keys have no successor — the frontier advances on reclaimable
 * volume now, not on how long the session sat idle — so they are simply
 * dropped rather than mapped onto something they never meant.
 */
export function migrateLegacyKeys(parsed: unknown, config: ThriftConfig): void {
  if (!isPlainObject(parsed)) return;
  const input = parsed.input;
  if (!isPlainObject(input)) return;

  if (typeof input.cacheAware === "boolean" && input.monotonic === undefined) {
    config.input.monotonic = input.cacheAware;
  }
}

export async function saveConfig(config: ThriftConfig): Promise<void> {
  const json = `${JSON.stringify(config, null, 2)}\n`;
  saveQueue = saveQueue.then(async () => {
    await mkdir(join(homedir(), ".pi", "agent"), { recursive: true });
    await writeFile(CONFIG_PATH, json, "utf8");
  });
  return saveQueue;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function mergeConfig(defaults: unknown, overrides: unknown): unknown {
  if (!isPlainObject(defaults)) {
    return overrides !== undefined ? overrides : defaults;
  }
  if (!isPlainObject(overrides)) {
    return structuredClone(defaults);
  }
  const out: Record<string, unknown> = { ...structuredClone(defaults) };
  for (const key of Object.keys(overrides)) {
    const defVal = defaults[key];
    const overVal = overrides[key];
    if (key in defaults && isPlainObject(defVal)) {
      out[key] = mergeConfig(defVal, overVal);
    } else {
      // Unknown keys are kept, not dropped. `maxResultBytes` is an open record:
      // a user who added a threshold for a custom tool would otherwise lose it
      // every time this file was rewritten.
      out[key] = overVal;
    }
  }
  return out;
}
