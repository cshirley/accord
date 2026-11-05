import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { DevHarnessConfig } from "@clive.shirley/accord-core/config/types.js";
import { ACCORD_TOOLS } from "@clive.shirley/accord-core/tools/registry.js";

// Pinned contract (spec leaves shapes open):
//  `accord feature find <arg> [--depth <level>]`: arg containing "/" is a code path, otherwise a query.
//  `accord feature impact <ID>` | `accord feature init`.
//  find/impact print exactly the `text` of dev_feature_find / dev_feature_impact followed by a newline,
//  against the same repo and config (AGENTS.md Dev Harness block). Exit 0 when the tool result is ok, else 1.
//  `--json` (global flag) prints JSON.stringify of the tool `details` instead of the text.
//  `--depth index|feature|change|evidence` maps to the tool `depth` param; bad/missing value exits 1 naming `--depth`.
//  init requires knowledge.enabled (else exit 1 with the tool disabled text, no file) and creates <knowledge.root>/index.json with {"features": []}; never scans.
//  init creates <knowledge.root>/index.json with {"features": []} (idempotent) and exits 0.
const ID = "ASDLC-1";
const MAIN = join(import.meta.dir, "..", "src", "main.ts");
const FEATURE_SRC = join(import.meta.dir, "..", "src", "commands", "feature.ts");

const HARNESS = (knowledge: unknown) => ({
  schema_version: "1.0",
  language: "typescript",
  test: { command: "bun test", file_pattern: "**/*.test.ts" },
  verification_commands: ["bun test"],
  ...(knowledge === undefined ? {} : { knowledge }),
});

const entry = (id: string, code: string[], extra: Record<string, unknown> = {}) => ({
  id,
  title: `${id} title`,
  description: `${id} description`,
  tags: [],
  status: "active",
  owners: [],
  acs: [],
  anchors: { code, interfaces: [] },
  depends_on: [],
  related: [],
  supersedes: [],
  path: `${id}.md`,
  ...extra,
});
const INDEX = {
  features: [
    entry("auth-refresh", ["src/auth/refresh.ts"], {
      description: "Token refresh flow",
      tags: ["security"],
    }),
    entry("session-store", ["src/session/store.ts"]),
    entry("billing", ["src/billing/charge.ts"], {
      description: "Invoice charging",
      tags: ["src/billing"],
    }),
  ],
};
const PLAN = {
  work_item_id: ID,
  tasks: [
    { id: 1, files: [{ path: "src/session/store.ts", action: "modify" }] },
    { id: 2, files: [{ path: "src/new/thing.ts", action: "add" }] },
  ],
};
const EVIDENCE_PATH = `docs/dev/${ID}/evidence/task-1.md`;

let repo = "";
let home = "";
const cleanups: string[] = [];

function write(rel: string, content: string): void {
  const full = join(repo, rel);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}
function writeConfig(knowledge: unknown): void {
  write(
    "AGENTS.md",
    `# Repo\n\n## Dev Harness\n\n\`\`\`json\n${JSON.stringify(HARNESS(knowledge), null, 2)}\n\`\`\`\n`,
  );
}
function seed(root = "docs/features"): void {
  write(`${root}/index.json`, `${JSON.stringify(INDEX, null, 2)}\n`);
  write(
    `${root}/auth-refresh.md`,
    `---\n${JSON.stringify({
      id: "auth-refresh",
      type: "feature",
      title: "auth-refresh title",
      description: "Token refresh flow",
      status: "active",
      acs: [{ id: "F-1", text: "does a thing", tests: [] }],
      anchors: { code: [], interfaces: [] },
      changes: [{ work_item: ID, evidence: EVIDENCE_PATH }],
    })}\n---\n# auth-refresh\n`,
  );
  write(EVIDENCE_PATH, "EVIDENCE-SENTINEL-4471\n");
  write(`docs/dev/${ID}/plan.json`, `${JSON.stringify(PLAN, null, 2)}\n`);
}

const SCRUBBED_ENV: NodeJS.ProcessEnv = (() => {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("ACCORD_")) delete env[key];
  }
  return env;
})();

function cliIn(cwd: string, ...args: string[]) {
  const res = spawnSync(process.execPath, [MAIN, ...args], {
    cwd,
    encoding: "utf8",
    env: {
      ...SCRUBBED_ENV,
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      NO_COLOR: "1",
    },
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}
const cli = (...args: string[]) => cliIn(repo, ...args);

async function tool(
  name: string,
  params: Record<string, unknown>,
  knowledge: unknown,
): Promise<{ ok: boolean; text: string; details?: unknown }> {
  const found = ACCORD_TOOLS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`tool ${name} not registered`);
  return (await found.handler({ ...params, cwd: repo } as never, {
    getConfig: () => HARNESS(knowledge) as unknown as DevHarnessConfig,
  })) as unknown as { ok: boolean; text: string; details?: unknown };
}
async function okText(
  name: string,
  params: Record<string, unknown>,
  knowledge: unknown,
): Promise<string> {
  const result = await tool(name, params, knowledge);
  expect({ name, ok: result.ok }).toEqual({ name, ok: true });
  return result.text;
}

const ENABLED = { enabled: true };

beforeEach(() => {
  repo = realpathSync(mkdtempSync(join(tmpdir(), "accord-feature-cli-")));
  home = realpathSync(mkdtempSync(join(tmpdir(), "accord-feature-cli-home-")));
  cleanups.push(repo, home);
  writeConfig(ENABLED);
});
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("ASDLC-1/AC-21 accord feature CLI and MCP parity (ASDLC-1/TC-22)", () => {
  it("ASDLC-1/AC-21 `feature find <query>` prints the dev_feature_find text", async () => {
    seed();
    const expected = await okText("dev_feature_find", { query: "invoice" }, ENABLED);
    expect(expected).toBe("billing: billing title [active]");
    const result = cli("feature", "find", "invoice");
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`${expected}\n`);
  }, 30_000);

  it("ASDLC-1/AC-21 `feature find <query>` matches tags and id like the tool", async () => {
    seed();
    for (const query of ["security", "AUTH-REFRESH"]) {
      const expected = await okText("dev_feature_find", { query }, ENABLED);
      expect(expected).toBe("auth-refresh: auth-refresh title [active]");
      const result = cli("feature", "find", query);
      expect(result.status).toBe(0);
      expect(result.stdout).toBe(`${expected}\n`);
    }
  }, 30_000);

  it("ASDLC-1/AC-21 `feature find <path>` prints the dev_feature_find text for the anchoring feature", async () => {
    seed();
    const expected = await okText("dev_feature_find", { path: "src/session/store.ts" }, ENABLED);
    expect(expected).toBe("session-store: session-store title [active]");
    const result = cli("feature", "find", "src/session/store.ts");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${expected}\n`);
  }, 30_000);

  it("ASDLC-1/AC-21 `feature find` with no match prints the tool's no-match text and exits 0", async () => {
    seed();
    const expected = await okText("dev_feature_find", { query: "zzz-none" }, ENABLED);
    expect(expected).toBe("No matching features");
    const result = cli("feature", "find", "zzz-none");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${expected}\n`);
    // a "/"-bearing arg is a path, never a query: 'src/billing' is a billing tag (a query would match)
    expect(await okText("dev_feature_find", { query: "src/billing" }, ENABLED)).toBe(
      "billing: billing title [active]",
    );
    const pathResult = cli("feature", "find", "src/billing");
    expect(pathResult.status).toBe(0);
    expect(pathResult.stdout).toBe("No matching features\n");
    const dotted = cli("feature", "find", "./src/session/store.ts");
    expect(dotted.status).toBe(0);
    expect(dotted.stdout).toBe("session-store: session-store title [active]\n");
  }, 30_000);

  it("ASDLC-1/AC-21 `feature impact <ID>` prints the dev_feature_impact text", async () => {
    seed();
    const expected = await okText("dev_feature_impact", { id: ID }, ENABLED);
    expect(expected).toContain("session-store: modifies");
    const result = cli("feature", "impact", ID);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(`${expected}\n`);
  }, 30_000);

  it("ASDLC-1/AC-21 `feature impact` reports tool error (missing plan) with exit 1", async () => {
    seed();
    const expected = await tool("dev_feature_impact", { id: "ASDLC-99" }, ENABLED);
    expect(expected.ok).toBe(false);
    expect(expected.text).toContain("plan.json not found");
    const result = cli("feature", "impact", "ASDLC-99");
    expect(result.status).toBe(1);
    expect(result.stdout).toBe(`${expected.text}\n`);
  }, 30_000);

  it("ASDLC-1/AC-21 find reports a missing index like the tool, exit 1", async () => {
    const expected = await tool("dev_feature_find", { query: "x" }, ENABLED);
    expect(expected.ok).toBe(false);
    const result = cli("feature", "find", "x");
    expect(result.status).toBe(1);
    expect(result.stdout).toBe(`${expected.text}\n`);
    expect(result.stdout).toContain("index.json");
  }, 30_000);

  it("ASDLC-1/AC-21 results come from the configured knowledge root", async () => {
    writeConfig({ enabled: true, root: "custom/kb" });
    seed("custom/kb");
    const expected = await okText(
      "dev_feature_find",
      { query: "invoice" },
      { enabled: true, root: "custom/kb" },
    );
    const result = cli("feature", "find", "invoice");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe(`${expected}\n`);
    expect(result.stdout).toBe("billing: billing title [active]\n");
    const custom = { enabled: true, root: "custom/kb" };
    const impact = cli("feature", "impact", ID);
    expect(impact.status).toBe(0);
    expect(impact.stdout).toBe(`${await okText("dev_feature_impact", { id: ID }, custom)}\n`);
    expect(impact.stdout).toContain("session-store: modifies");
    const byPath = cli("feature", "find", "src/session/store.ts");
    expect(byPath.status).toBe(0);
    expect(byPath.stdout).toBe("session-store: session-store title [active]\n");
    expect(existsSync(join(repo, "docs/features/index.json"))).toBe(false);
  }, 30_000);

  it("ASDLC-1/AC-21 `--json` and `--depth` expose the index, feature, change and evidence layers", async () => {
    seed();
    const full = cli("feature", "find", "auth-refresh", "--json");
    expect(full.status).toBe(0);
    expect(full.stderr).toBe("");
    const fullTool = await tool("dev_feature_find", { query: "auth-refresh" }, ENABLED);
    expect(JSON.parse(full.stdout)).toEqual(fullTool.details as never);
    const fullDetails = JSON.parse(full.stdout) as {
      matches: Array<{ evidence?: Array<{ content: string }>; acs?: unknown; changes?: unknown }>;
      reads: Array<{ level: string; path: string }>;
    };
    expect(fullDetails.matches[0]?.evidence?.[0]?.content).toBe("EVIDENCE-SENTINEL-4471\n");
    expect(fullDetails.reads.map((read) => read.level)).toEqual([
      "index",
      "feature",
      "change",
      "evidence",
    ]);

    const index = cli("feature", "find", "auth-refresh", "--depth", "index", "--json");
    expect(index.status).toBe(0);
    const indexTool = await tool(
      "dev_feature_find",
      { query: "auth-refresh", depth: "index" },
      ENABLED,
    );
    expect(JSON.parse(index.stdout)).toEqual(indexTool.details as never);
    const indexDetails = JSON.parse(index.stdout) as {
      matches: Array<Record<string, unknown>>;
      reads: unknown;
    };
    expect(indexDetails.reads).toEqual([{ level: "index", path: "docs/features/index.json" }]);
    expect(indexDetails.matches[0]).not.toHaveProperty("acs");
    expect(indexDetails.matches[0]).not.toHaveProperty("changes");
    expect(indexDetails.matches[0]).not.toHaveProperty("evidence");

    const feature = cli("feature", "find", "auth-refresh", "--depth", "feature", "--json");
    expect(feature.status).toBe(0);
    const featureDetails = JSON.parse(feature.stdout) as {
      matches: Array<Record<string, unknown>>;
      reads: Array<{ level: string }>;
    };
    expect(featureDetails.reads.map((read) => read.level)).toEqual(["index", "feature"]);
    expect(featureDetails.matches[0]).toHaveProperty("acs");
    expect(featureDetails.matches[0]).not.toHaveProperty("changes");

    // --depth without --json: flag parsed, not part of the query
    const text = cli("feature", "find", "invoice", "--depth", "index");
    expect(text.status).toBe(0);
    expect(text.stdout).toBe(
      `${await okText("dev_feature_find", { query: "invoice", depth: "index" }, ENABLED)}\n`,
    );

    const impact = cli("feature", "impact", ID, "--json");
    expect(impact.status).toBe(0);
    const impactTool = await tool("dev_feature_impact", { id: ID }, ENABLED);
    expect(JSON.parse(impact.stdout)).toEqual(impactTool.details as never);
  }, 60_000);

  it("ASDLC-1/AC-21 bad or missing --depth value exits 1 naming --depth", () => {
    seed();
    for (const args of [
      ["feature", "find", "invoice", "--depth", "bogus"],
      ["feature", "find", "invoice", "--depth"],
    ]) {
      const result = cli(...args);
      expect({ args, status: result.status }).toEqual({ args, status: 1 });
      expect(`${result.stdout}${result.stderr}`).toContain("--depth");
    }
  }, 30_000);

  it("ASDLC-1/AC-21 --cwd selects the project root for find, impact and init", async () => {
    seed();
    const find = cliIn(home, "feature", "find", "invoice", "--cwd", repo);
    expect(find.status).toBe(0);
    expect(find.stderr).toBe("");
    expect(find.stdout).toBe(
      `${await okText("dev_feature_find", { query: "invoice" }, ENABLED)}\n`,
    );
    const impact = cliIn(home, "feature", "impact", ID, "--cwd", repo);
    expect(impact.status).toBe(0);
    expect(impact.stdout).toBe(`${await okText("dev_feature_impact", { id: ID }, ENABLED)}\n`);
    const fresh = realpathSync(mkdtempSync(join(tmpdir(), "accord-feature-cli-fresh-")));
    cleanups.push(fresh);
    writeFileSync(
      join(fresh, "AGENTS.md"),
      `# Repo\n\n## Dev Harness\n\n\`\`\`json\n${JSON.stringify(HARNESS(ENABLED), null, 2)}\n\`\`\`\n`,
    );
    const init = cliIn(home, "feature", "init", "--cwd", fresh);
    expect(init.status).toBe(0);
    expect(init.stderr).toBe("");
    expect(existsSync(join(fresh, "docs/features/index.json"))).toBe(true);
    expect(existsSync(join(home, "docs/features/index.json"))).toBe(false);
  }, 60_000);

  it("ASDLC-1/AC-21 knowledge disabled or absent: find/impact print the tool's disabled text, exit 1", async () => {
    seed();
    for (const knowledge of [undefined, { enabled: false }]) {
      writeConfig(knowledge);
      const findExpected = await tool("dev_feature_find", { query: "invoice" }, knowledge);
      expect(findExpected.ok).toBe(false);
      expect(findExpected.text).toContain("knowledge.enabled");
      const find = cli("feature", "find", "invoice");
      expect(find.status).toBe(1);
      expect(find.stdout).toBe(`${findExpected.text}\n`);

      const impactExpected = await tool("dev_feature_impact", { id: ID }, knowledge);
      const impact = cli("feature", "impact", ID);
      expect(impact.status).toBe(1);
      expect(impact.stdout).toBe(`${impactExpected.text}\n`);
    }
  }, 30_000);

  it("ASDLC-1/AC-21 `feature init` creates an empty index and is idempotent", () => {
    const index = join(repo, "docs/features/index.json");
    // docs and sources exist, but init never scans or builds from them
    write(
      "docs/features/auth-refresh.md",
      `---\n${JSON.stringify({ id: "auth-refresh", type: "feature", title: "t", status: "active" })}\n---\n`,
    );
    write("src/session/store.ts", "export const x = 1;\n");
    expect(existsSync(index)).toBe(false);
    const first = cli("feature", "init");
    expect(first.status).toBe(0);
    expect(first.stderr).toBe("");
    expect(JSON.parse(readFileSync(index, "utf8"))).toEqual({ features: [] });
    // never scans the repo and never overwrites an existing index
    seed();
    const second = cli("feature", "init");
    expect(second.status).toBe(0);
    expect(JSON.parse(readFileSync(index, "utf8"))).toEqual(INDEX);
  }, 30_000);

  it("ASDLC-1/AC-21 `feature init` needs knowledge enabled: exit 1, tool disabled text, no file", async () => {
    for (const knowledge of [undefined, { enabled: false }]) {
      writeConfig(knowledge);
      const expected = await tool("dev_feature_find", { query: "x" }, knowledge);
      const result = cli("feature", "init");
      expect(result.status).toBe(1);
      expect(result.stdout).toBe(`${expected.text}\n`);
      expect(result.stdout).toContain("knowledge.enabled");
      expect(existsSync(join(repo, "docs/features/index.json"))).toBe(false);
    }
  }, 30_000);

  it("ASDLC-1/AC-21 `feature init` honours a custom knowledge root", () => {
    writeConfig({ enabled: true, root: "custom/kb" });
    const result = cli("feature", "init");
    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(join(repo, "custom/kb/index.json"), "utf8"))).toEqual({
      features: [],
    });
    expect(existsSync(join(repo, "docs/features/index.json"))).toBe(false);
  }, 30_000);

  it("ASDLC-1/AC-21 bad usage exits non-zero: missing verb, unknown verb, missing arg", () => {
    seed();
    for (const args of [
      ["feature"],
      ["feature", "bogus"],
      ["feature", "find"],
      ["feature", "impact"],
      ["feature", "find", "a", "b"],
      ["feature", "impact", ID, "X"],
      ["feature", "init", "x"],
      ["feature", "find", ""],
    ]) {
      const result = cli(...args);
      expect({ args, status: result.status }).toEqual({ args, status: 1 });
      expect(`${result.stdout}${result.stderr}`).toMatch(/feature (find|impact|init)/);
    }
  }, 60_000);
});

describe("ASDLC-1/AC-28 feature command is a thin adapter", () => {
  const SRC_DIR = join(import.meta.dir, "..", "src");
  const importSpecs = (source: string): string[] =>
    [
      ...source.matchAll(/\bfrom\s+["']([^"']+)["']/g),
      ...source.matchAll(/\bimport\s+["']([^"']+)["']/g),
      ...source.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
      ...source.matchAll(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/g),
    ].map((match) => match[1] as string);
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((dirent) =>
      dirent.isDirectory() ? walk(join(dir, dirent.name)) : [join(dir, dirent.name)],
    );

  it("ASDLC-1/AC-28 commands/feature.ts delegates to accord-core knowledge/tools and imports no Pi package", () => {
    const specs = importSpecs(readFileSync(FEATURE_SRC, "utf8"));
    expect(
      specs.some(
        (spec) =>
          spec === "@clive.shirley/accord-core/knowledge/query.js" ||
          spec === "@clive.shirley/accord-core/tools/registry.js",
      ),
    ).toBe(true);
    for (const spec of specs) {
      expect(spec).not.toMatch(/pi-|@earendil-works|@mariozechner/);
      expect(spec).not.toMatch(/^(node:)?fs(\/|$)/);
      if (spec.startsWith(".")) expect(["../context.js"]).toContain(spec);
    }
  });

  it("ASDLC-1/AC-28 no accord-cli source file embeds the feature index path", () => {
    for (const file of walk(SRC_DIR).filter((name) => name.endsWith(".ts"))) {
      const source = readFileSync(file, "utf8");
      expect({ file, hit: /index\.json|docs\/features/.test(source) }).toEqual({
        file,
        hit: false,
      });
    }
  });
  // check:types, check:bundle and layering.test.ts enforcement belong to phase-verify-task
});

describe("ASDLC-1/AC-31 documentation of the feature command", () => {
  it("ASDLC-1/AC-31 okf/references/accord-cli.md has a feature row naming find, impact, init, --depth, knowledge.enabled and dev_feature", () => {
    const doc = readFileSync(
      join(import.meta.dir, "..", "..", "..", "okf", "references", "accord-cli.md"),
      "utf8",
    );
    const row = doc.split("\n").find((line) => /^\|\s*`feature /.test(line));
    expect(row).toBeDefined();
    expect(row).toContain("find <query\\|path>");
    expect(row).toContain("impact <ID>");
    expect(row).toContain("init");
    expect(row).toContain("--depth");
    expect(row).toContain("knowledge.enabled");
    expect(row).toContain("dev_feature");
    // validate:okf / validate:ste / check:biome and the dated okf/log.md entry (task 50) are phase-verify-task
  });
});
