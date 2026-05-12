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
    /** Max bytes per tool result at source (tool_result hook). */
    maxResultBytes: Record<string, number>;
    /** Max lines per tool result at source. */
    maxResultLines: number;
    /** Number of recent turns whose tool output is kept in full. */
    keepRecentTurns: number;
    /** Results smaller than this are never stubbed (bytes). */
    stubThresholdBytes: number;
    /**
     * Cache-aware monotonic stubbing.
     *
     * When enabled, once a tool result has been sent un-stubbed within the
     * provider's prompt-cache TTL window, it stays un-stubbed for the rest
     * of that window — guaranteeing byte-identical prefixes and maximum
     * cache hits. After the TTL elapses (cache is dead), decisions reset
     * and the standard `keepRecentTurns` rule applies again.
     */
    cacheAware: boolean;
    /** Per-provider prompt-cache TTL in milliseconds. */
    providerTTLs: Record<string, number>;
    /** Fallback TTL when the active provider is not in providerTTLs. */
    defaultTTL: number;
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
      bash: 10_000, //  10 KB — keep tail (errors, exit codes)
      read: 40_000, //  40 KB — keep head (covers ~95% of files)
      grep: 5_000, //   5 KB — keep head (first matches)
      find: 5_000, //   5 KB — keep head (first results)
      ls: 5_000, //     5 KB — keep head (first entries)
    },
    maxResultLines: 500,
    keepRecentTurns: 3,
    stubThresholdBytes: 200,
    cacheAware: true,
    providerTTLs: {
      anthropic: 5 * 60_000, //  5 min — standard ephemeral cache TTL
      openai: 10 * 60_000, // ~10 min — sliding cached input window
      google: 0, //              implicit cache, no stable TTL guarantee
      groq: 0, //                no published cache TTL
      cerebras: 0,
      xai: 0,
      openrouter: 5 * 60_000, // varies by underlying model
      "local-openai": 0,
    },
    defaultTTL: 5 * 60_000,
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
    const config = merge(DEFAULT_CONFIG, parsed) as ThriftConfig;
    if (!OUTPUT_LEVELS.includes(config.output.level)) {
      config.output.level = DEFAULT_CONFIG.output.level;
    }
    return config;
  } catch {
    return structuredClone(DEFAULT_CONFIG);
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

function merge(defaults: unknown, overrides: unknown): unknown {
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
      out[key] = merge(defVal, overVal);
    } else {
      out[key] = overVal;
    }
  }
  return out;
}
