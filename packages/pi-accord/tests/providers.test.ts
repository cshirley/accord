import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { DevHarnessConfig } from "../src/core/config/types.js";
import { runGatherPreflightOnSubagentCall } from "../src/core/harness/index.js";
import {
  checkProviderDeps,
  type DepCheckResult,
  formatPreflightReport,
  loadAllProviders,
  loadBundledProviders,
  loadUserProviders,
  normaliseUserProvider,
  type ProviderDef,
} from "../src/integrations/provider-deps.js";

const tempDirs: string[] = [];
const savedEnv: Record<string, string | undefined> = {};

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "accord-providers-"));
  tempDirs.push(dir);
  return dir;
}

/**
 * Mutate process.env and remember the original value on FIRST call so
 * afterEach can restore it. Subsequent setEnv calls for the same key keep
 * the originally-saved baseline. Do NOT delete savedEnv[key] inside test
 * bodies or cleanup will leak the mutation.
 */
function setEnv(key: string, value: string | undefined): void {
  if (!(key in savedEnv)) savedEnv[key] = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
    delete savedEnv[k];
  }
});

function sampleConfig(overrides: Partial<DevHarnessConfig> = {}): DevHarnessConfig {
  return {
    schema_version: "1.0",
    language: "typescript",
    test: { command: "bun test" },
    type_check: null,
    lint: null,
    format: null,
    verification_commands: ["bun test"],
    ...overrides,
  };
}

function fakeDef(overrides: Partial<ProviderDef> = {}): ProviderDef {
  return {
    name: "x",
    kind: "tracker",
    label: "X",
    mcpTools: [],
    cliFallback: null,
    envFallback: null,
    promptFile: "/tmp/x.md",
    ...overrides,
  };
}

// loadBundledProviders

describe("loadBundledProviders", () => {
  test("loads the expected bundled trackers and enrichments from sidecars", () => {
    const set = loadBundledProviders();
    expect([...set.trackers.keys()].sort()).toEqual(["github", "gitlab", "jira", "plain-text"]);
    expect([...set.enrichments.keys()].sort()).toEqual([
      "confluence",
      "figma",
      "github-discussions",
      "github-pr",
      "google-docs",
      "slack",
    ]);
  });

  test("resolves promptFile to an absolute path next to the sidecar", () => {
    const jira = loadBundledProviders().trackers.get("jira")!;
    expect(jira.kind).toBe("tracker");
    expect(isAbsolute(jira.promptFile)).toBe(true);
    expect(jira.promptFile.endsWith("/assets/providers/trackers/jira.md")).toBe(true);
  });

  test("preserves mcpTools, cliFallback and envFallback from the sidecar", () => {
    const slack = loadBundledProviders().enrichments.get("slack")!;
    expect(slack.mcpTools).toContain("mcp__slack__search_messages");
    expect(slack.cliFallback).toBeNull();
    expect(slack.envFallback).toBe("SLACK_BOT_TOKEN");

    const gitlab = loadBundledProviders().trackers.get("gitlab")!;
    expect(gitlab.cliFallback).toBe("glab");
    expect(gitlab.envFallback).toBe("GITLAB_TOKEN");
  });
});

// normaliseUserProvider

describe("normaliseUserProvider", () => {
  test("rejects malformed input", () => {
    expect(normaliseUserProvider(null)).toBeNull();
    expect(normaliseUserProvider("nope")).toBeNull();
    expect(normaliseUserProvider({})).toBeNull();
    expect(normaliseUserProvider({ name: "a", kind: "bogus", promptFile: "/x.md" })).toBeNull();
    expect(normaliseUserProvider({ name: "a", kind: "tracker" })).toBeNull();
    expect(normaliseUserProvider({ kind: "tracker", promptFile: "/x.md" })).toBeNull();
  });

  test("applies defaults and filters non-string mcpTools entries", () => {
    const def = normaliseUserProvider({
      name: "custom",
      kind: "enrichment",
      promptFile: "/abs/custom.md",
      mcpTools: ["a", 42, "b", null, "c"],
    });
    expect(def).not.toBeNull();
    expect(def?.label).toBe("custom");
    expect(def?.mcpTools).toEqual(["a", "b", "c"]);
    expect(def?.cliFallback).toBeNull();
    expect(def?.envFallback).toBeNull();
  });

  test("expands ~/ paths to the user home directory", () => {
    const def = normaliseUserProvider({
      name: "h",
      kind: "tracker",
      promptFile: "~/custom/h.md",
    });
    expect(def?.promptFile).toBe(join(homedir(), "custom/h.md"));
  });
});

// loadUserProviders / loadAllProviders

describe("loadUserProviders + loadAllProviders", () => {
  test("loadUserProviders splits entries into trackers and enrichments by kind", () => {
    const set = loadUserProviders([
      { name: "t1", kind: "tracker", promptFile: "/a.md" },
      { name: "e1", kind: "enrichment", promptFile: "/b.md" },
      { name: "bad" },
    ]);
    expect([...set.trackers.keys()]).toEqual(["t1"]);
    expect([...set.enrichments.keys()]).toEqual(["e1"]);
  });

  test("loadAllProviders merges bundled with user defs", () => {
    const set = loadAllProviders([{ name: "my-tracker", kind: "tracker", promptFile: "/u/t.md" }]);
    expect(set.trackers.has("jira")).toBe(true);
    expect(set.trackers.has("my-tracker")).toBe(true);
  });

  test("loadAllProviders lets a user provider override a bundled provider with the same name", () => {
    const set = loadAllProviders([
      {
        name: "jira",
        kind: "tracker",
        label: "Internal Jira",
        promptFile: "/custom/jira.md",
        mcpTools: ["mcp__internal__jira"],
      },
    ]);
    const jira = set.trackers.get("jira")!;
    expect(jira.label).toBe("Internal Jira");
    expect(jira.promptFile).toBe("/custom/jira.md");
    expect(jira.mcpTools).toEqual(["mcp__internal__jira"]);
  });
});

// checkProviderDeps

describe("checkProviderDeps", () => {
  test("returns not-needed when the def has no tools, cli, or env", () => {
    const r = checkProviderDeps(fakeDef({ name: "noop" }), new Set());
    expect(r.available).toBe(true);
    expect(r.method).toBe("not-needed");
  });

  test("prefers an MCP match over CLI and env", () => {
    const def = fakeDef({
      mcpTools: ["mcp__a", "mcp__b"],
      cliFallback: "sh",
      envFallback: "ANY_ENV",
    });
    setEnv("ANY_ENV", "1");
    const r = checkProviderDeps(def, new Set(["mcp__b"]));
    expect(r.method).toBe("mcp");
    expect(r.detail).toBe("mcp__b");
  });

  test("falls back to CLI when no MCP match and the binary exists", () => {
    const def = fakeDef({ mcpTools: ["mcp__missing"], cliFallback: "sh" });
    const r = checkProviderDeps(def, new Set());
    expect(r.method).toBe("cli");
    expect(r.detail).toBe("sh");
  });

  test("falls back to env var when MCP and CLI are unavailable", () => {
    const def = fakeDef({
      mcpTools: ["mcp__missing"],
      cliFallback: "definitely-not-on-this-system-xyz",
      envFallback: "TEST_PROVIDER_TOKEN",
    });
    setEnv("TEST_PROVIDER_TOKEN", "abc");
    const r = checkProviderDeps(def, new Set());
    expect(r.method).toBe("env");
    expect(r.detail).toBe("$TEST_PROVIDER_TOKEN");
  });

  test("reports none and lists every tried mechanism when nothing is available", () => {
    const def = fakeDef({
      mcpTools: ["mcp__missing"],
      cliFallback: "definitely-not-on-this-system-xyz",
      envFallback: "DEFINITELY_UNSET_ENV_VAR_XYZ",
    });
    setEnv("DEFINITELY_UNSET_ENV_VAR_XYZ", undefined);
    const r = checkProviderDeps(def, new Set());
    expect(r.available).toBe(false);
    expect(r.method).toBe("none");
    expect(r.detail).toContain("MCP: mcp__missing");
    expect(r.detail).toContain("CLI: definitely-not-on-this-system-xyz");
    expect(r.detail).toContain("env: $DEFINITELY_UNSET_ENV_VAR_XYZ");
  });
});

// formatPreflightReport

describe("formatPreflightReport", () => {
  function asResult(over: Partial<DepCheckResult> = {}): DepCheckResult {
    return {
      provider: "jira",
      label: "Jira",
      available: true,
      method: "mcp",
      detail: "mcp__x",
      promptFile: "/abs/jira.md",
      ...over,
    };
  }

  test("renders header, tracker line, enrichments, and the Provider Playbooks block", () => {
    const out = formatPreflightReport(asResult(), [
      asResult({ provider: "slack", label: "Slack", promptFile: "/abs/slack.md" }),
    ]);
    expect(out).toContain("Gather Preflight");
    expect(out).toContain("Tracker: Jira via mcp (mcp__x)");
    expect(out).toContain("Slack via mcp (mcp__x)");
    expect(out).toContain("Provider Playbooks");
    expect(out).toContain("Tracker (jira): /abs/jira.md");
    expect(out).toContain("Enrichment (slack): /abs/slack.md");
    expect(out).toContain("All configured sources available");
  });

  test("emits the unavailable warning and detail when sources fail", () => {
    const out = formatPreflightReport(
      asResult({ available: false, method: "none", detail: "MCP: mcp__x" }),
      [],
    );
    expect(out).toContain("UNAVAILABLE (tried: MCP: mcp__x)");
    expect(out).toMatch(/1 source\(s\) unavailable/);
  });
});

// gather-preflight integration with user providers

describe("gather preflight with user-defined providers", () => {
  test("user-defined tracker is preflighted and its abs playbook path is injected", async () => {
    const dir = tempDir();
    const playbook = join(dir, "internal-tracker.md");
    writeFileSync(playbook, "# internal tracker\n", "utf8");

    setEnv("INTERNAL_TRACKER_TOKEN", "abc");
    const cfg = sampleConfig({
      tracker: { type: "internal-tracker" },
      providers: [
        {
          name: "internal-tracker",
          kind: "tracker",
          label: "Internal tracker",
          promptFile: playbook,
          envFallback: "INTERNAL_TRACKER_TOKEN",
        },
      ],
    });

    const input: Record<string, unknown> = { agent: "phase-gather", task: "base" };
    const r = await runGatherPreflightOnSubagentCall(input, cfg, new Set(), { notify: () => {} });

    expect(r.blockReason).toBeUndefined();
    const task = String(input.task);
    expect(task).toContain("Tracker: Internal tracker via env");
    expect(task).toContain(`Tracker (internal-tracker): ${playbook}`);
  });

  test("user-defined enrichment merges with context_sources and shows in the report", async () => {
    const dir = tempDir();
    const playbook = join(dir, "internal-wiki.md");
    writeFileSync(playbook, "# internal wiki\n", "utf8");

    const cfg = sampleConfig({
      tracker: { type: "plain-text" },
      context_sources: [{ type: "internal-wiki" }],
      providers: [
        {
          name: "internal-wiki",
          kind: "enrichment",
          label: "Internal Wiki",
          promptFile: playbook,
        },
      ],
    });

    const input: Record<string, unknown> = { agent: "phase-gather", task: "base" };
    const r = await runGatherPreflightOnSubagentCall(input, cfg, new Set(), { notify: () => {} });

    expect(r.blockReason).toBeUndefined();
    const task = String(input.task);
    expect(task).toContain("Internal Wiki via not-needed");
    expect(task).toContain(`Enrichment (internal-wiki): ${playbook}`);
  });
});
