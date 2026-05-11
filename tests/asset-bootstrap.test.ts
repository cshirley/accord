import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { maybeAutoInstallAssets } from "../src/core/harness/asset-bootstrap.js";
import {
  currentAssetSignature,
  installPiAssets,
  readInstalledMetadata,
} from "../src/core/asset-install.js";
import {
  defaultGlobalConfigTemplate,
  seedGlobalConfigFile,
  stripJsonComments,
} from "../src/core/config/global.js";

const tempDirs: string[] = [];

function tempPiAgent(): string {
  const dir = mkdtempSync(join(tmpdir(), "accord-pi-agent-"));
  tempDirs.push(dir);
  return dir;
}

function captureNotifies() {
  const events: { level: "info" | "warning"; message: string }[] = [];
  return {
    host: { notify: (level: "info" | "warning", message: string) => events.push({ level, message }) },
    events,
  };
}

afterEach(() => {
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

// ── installPiAssets (the underlying installer) ───────────────

describe("installPiAssets", () => {
  test("links the bundled assets and writes metadata into a fresh target", () => {
    const target = tempPiAgent();
    const result = installPiAssets({ target });

    expect(result.linked.length).toBeGreaterThan(0);
    expect(result.conflicts).toEqual([]);
    // Top-level symlinks created (the targets themselves; not asserting
    // through-link reads which break under macOS /var → /private/var
    // canonicalisation when readlink returns a relative path).
    expect(readlinkSync(join(target, "skills", "accord"))).toContain("assets/skills/accord");
    expect(readlinkSync(join(target, "agents", "accord"))).toContain("assets/agents/accord");
    expect(readlinkSync(join(target, "providers"))).toContain("assets/providers");
    expect(existsSync(result.metadataPath)).toBe(true);

    const meta = JSON.parse(readFileSync(result.metadataPath, "utf8"));
    expect(meta.package).toBe("@clive.shirley/pi-accord");
    expect(typeof meta.manifest_sha256).toBe("string");
    expect(typeof meta.version).toBe("string");
  });

  test("is idempotent: a second run links nothing and leaves metadata intact", () => {
    const target = tempPiAgent();
    installPiAssets({ target });
    const second = installPiAssets({ target });
    expect(second.linked).toEqual([]);
    expect(second.conflicts).toEqual([]);
  });

  test("dryRun reports what would be linked without writing into the target", () => {
    const target = tempPiAgent();
    const result = installPiAssets({ target, dryRun: true });
    expect(result.linked.length).toBeGreaterThan(0);
    expect(existsSync(join(target, "skills", "accord"))).toBe(false);
    expect(existsSync(join(target, "agents", "accord"))).toBe(false);
    expect(existsSync(join(target, "providers"))).toBe(false);
    expect(existsSync(result.metadataPath)).toBe(false);
  });

  test("seeds accord-config.json on first install with commented examples", () => {
    const target = tempPiAgent();
    const result = installPiAssets({ target });

    expect(result.globalConfigSeed).toBe("created");
    const configPath = join(target, "accord-config.json");
    expect(existsSync(configPath)).toBe(true);

    const raw = readFileSync(configPath, "utf8");
    // Commented examples are present so users can uncomment them.
    expect(raw).toContain("asset_bootstrap");
    expect(raw).toContain("context_sources");
    expect(raw).toContain("providers");
    // The active object is empty: every example field stays commented.
    expect(JSON.parse(stripJsonComments(raw))).toEqual({});
  });

  test("a second install does not overwrite a user-edited accord-config.json", () => {
    const target = tempPiAgent();
    installPiAssets({ target });

    const configPath = join(target, "accord-config.json");
    const userContent = '{ "asset_bootstrap": { "auto_install": false } }\n';
    writeFileSync(configPath, userContent, "utf8");

    const second = installPiAssets({ target });
    expect(second.globalConfigSeed).toBe("exists");
    expect(readFileSync(configPath, "utf8")).toBe(userContent);
  });

  test("dryRun does not seed the global config", () => {
    const target = tempPiAgent();
    const result = installPiAssets({ target, dryRun: true });
    expect(result.globalConfigSeed).toBe("exists");
    expect(existsSync(join(target, "accord-config.json"))).toBe(false);
  });

  test("reports conflicts when a target exists with different content and force is false", () => {
    const target = tempPiAgent();
    // Pre-create skills/accord as a regular file (not a symlink) so the installer flags it
    const skillsDir = join(target, "skills");
    mkdirSync(skillsDir, { recursive: true });
    writeFileSync(join(skillsDir, "accord"), "user content", "utf8");

    const result = installPiAssets({ target });
    expect(result.conflicts.length).toBeGreaterThan(0);
    // Metadata is not written when there are conflicts
    expect(existsSync(result.metadataPath)).toBe(false);
  });
});

// ── readInstalledMetadata + currentAssetSignature ──────────

describe("metadata helpers", () => {
  test("readInstalledMetadata returns null when the file is missing or malformed", () => {
    const target = tempPiAgent();
    expect(readInstalledMetadata(target)).toBeNull();

    writeFileSync(join(target, ".accord-assets.json"), "not json", "utf8");
    expect(readInstalledMetadata(target)).toBeNull();
  });

  test("currentAssetSignature is stable across calls", () => {
    const a = currentAssetSignature();
    const b = currentAssetSignature();
    expect(a).toEqual(b);
    expect(a.manifest_sha256.length).toBe(64);
  });
});

// ── maybeAutoInstallAssets behaviour matrix ─────────────────

describe("maybeAutoInstallAssets", () => {
  test("first install: no metadata + auto-install enabled → installs and notifies info", () => {
    const target = tempPiAgent();
    const { host, events } = captureNotifies();

    const r = maybeAutoInstallAssets(host, { target, env: {} });

    expect(r.status).toBe("installed");
    expect(r.linked).toBeGreaterThan(0);
    expect(events).toHaveLength(1);
    expect(events[0].level).toBe("info");
    expect(events[0].message).toMatch(/linked \d+ bundled asset\(s\)/);
    expect(events[0].message).toMatch(/restart pi/);
    expect(existsSync(join(target, ".accord-assets.json"))).toBe(true);
  });

  test("metadata current → silent no-op, no notification", () => {
    const target = tempPiAgent();
    installPiAssets({ target });
    const { host, events } = captureNotifies();

    const r = maybeAutoInstallAssets(host, { target, env: {} });

    expect(r.status).toBe("current");
    expect(r.linked).toBe(0);
    expect(events).toEqual([]);
  });

  test("stale metadata (version drift) → reconciles silently when symlinks already correct", () => {
    const target = tempPiAgent();
    installPiAssets({ target });
    // Tamper with recorded version so the bootstrap thinks the install is stale
    const metaPath = join(target, ".accord-assets.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    meta.version = "0.0.0-stale";
    writeFileSync(metaPath, JSON.stringify(meta));

    const { host, events } = captureNotifies();
    const r = maybeAutoInstallAssets(host, { target, env: {} });

    // Symlinks already point at the right targets, so installPiAssets
    // returns linked.length === 0 and the bootstrap takes the
    // "reconciled" edge case in asset-bootstrap.ts: status="current",
    // no notification. Pinning this so a later change that DOES relink
    // (or DOES notify on reconcile) gets caught.
    expect(r.status).toBe("current");
    expect(r.linked).toBe(0);
    expect(events).toEqual([]);
  });

  test("stale metadata + missing symlinks → re-installs and notifies info", () => {
    const target = tempPiAgent();
    installPiAssets({ target });
    // Tamper with recorded version AND remove the symlinks so the bootstrap
    // has actual relink work to do (covers the "installed" branch of the
    // stale-metadata behaviour matrix).
    const metaPath = join(target, ".accord-assets.json");
    const meta = JSON.parse(readFileSync(metaPath, "utf8"));
    meta.version = "0.0.0-stale";
    writeFileSync(metaPath, JSON.stringify(meta));
    rmSync(join(target, "skills", "accord"));
    rmSync(join(target, "agents", "accord"));
    rmSync(join(target, "providers"));

    const { host, events } = captureNotifies();
    const r = maybeAutoInstallAssets(host, { target, env: {} });

    expect(r.status).toBe("installed");
    expect(r.linked).toBeGreaterThan(0);
    expect(events).toHaveLength(1);
    expect(events[0].level).toBe("info");
    expect(events[0].message).toMatch(/re-linked/);
    expect(events[0].message).toMatch(/restart pi/);
  });

  test("ACCORD_AUTO_INSTALL_ASSETS=false skips install and warns instead", () => {
    const target = tempPiAgent();
    const { host, events } = captureNotifies();

    const r = maybeAutoInstallAssets(host, {
      target,
      env: { ACCORD_AUTO_INSTALL_ASSETS: "false" },
    });

    expect(r.status).toBe("skipped-by-env");
    expect(r.linked).toBe(0);
    expect(events).toHaveLength(1);
    expect(events[0].level).toBe("warning");
    expect(events[0].message).toMatch(/install:assets/);
    expect(existsSync(join(target, ".accord-assets.json"))).toBe(false);
  });

  test.each(["FALSE", "0", "no", "off"])(
    "ACCORD_AUTO_INSTALL_ASSETS=%s also disables auto-install",
    value => {
      const target = tempPiAgent();
      const { host } = captureNotifies();
      const r = maybeAutoInstallAssets(host, {
        target,
        env: { ACCORD_AUTO_INSTALL_ASSETS: value },
      });
      expect(r.status).toBe("skipped-by-env");
    },
  );

  test("global config asset_bootstrap.auto_install=false disables install", () => {
    const target = tempPiAgent();
    const { host, events } = captureNotifies();

    const r = maybeAutoInstallAssets(host, {
      target,
      env: {},
      globalConfig: { asset_bootstrap: { auto_install: false } },
    });

    expect(r.status).toBe("skipped-by-env");
    expect(r.linked).toBe(0);
    expect(events).toHaveLength(1);
    expect(events[0].message).toMatch(/accord-config\.json/);
    expect(events[0].message).toMatch(/install:assets/);
  });

  test("global config asset_bootstrap.auto_install=true installs (explicit opt-in)", () => {
    const target = tempPiAgent();
    const { host } = captureNotifies();

    const r = maybeAutoInstallAssets(host, {
      target,
      env: {},
      globalConfig: { asset_bootstrap: { auto_install: true } },
    });

    expect(r.status).toBe("installed");
    expect(r.linked).toBeGreaterThan(0);
  });

  test("env var overrides global config (env=true wins over config=false)", () => {
    const target = tempPiAgent();
    const { host } = captureNotifies();

    const r = maybeAutoInstallAssets(host, {
      target,
      env: { ACCORD_AUTO_INSTALL_ASSETS: "true" },
      globalConfig: { asset_bootstrap: { auto_install: false } },
    });

    expect(r.status).toBe("installed");
    expect(r.linked).toBeGreaterThan(0);
  });

  test("env var overrides global config (env=false wins over config=true)", () => {
    const target = tempPiAgent();
    const { host, events } = captureNotifies();

    const r = maybeAutoInstallAssets(host, {
      target,
      env: { ACCORD_AUTO_INSTALL_ASSETS: "false" },
      globalConfig: { asset_bootstrap: { auto_install: true } },
    });

    expect(r.status).toBe("skipped-by-env");
    expect(events[0].message).toMatch(/ACCORD_AUTO_INSTALL_ASSETS/);
  });

  test("missing global config falls through to default (enabled)", () => {
    const target = tempPiAgent();
    const { host } = captureNotifies();

    const r = maybeAutoInstallAssets(host, {
      target,
      env: {},
      globalConfig: null,
    });

    expect(r.status).toBe("installed");
  });

  test("global config without asset_bootstrap key falls through to default", () => {
    const target = tempPiAgent();
    const { host } = captureNotifies();

    const r = maybeAutoInstallAssets(host, {
      target,
      env: {},
      globalConfig: { context_sources: [] },
    });

    expect(r.status).toBe("installed");
  });

  test("invalid env value (e.g. 'maybe') falls through to global config", () => {
    const target = tempPiAgent();
    const { host, events } = captureNotifies();

    const r = maybeAutoInstallAssets(host, {
      target,
      env: { ACCORD_AUTO_INSTALL_ASSETS: "maybe" },
      globalConfig: { asset_bootstrap: { auto_install: false } },
    });

    expect(r.status).toBe("skipped-by-env");
    expect(events[0].message).toMatch(/accord-config\.json/);
  });

  test("conflicts → warns with --force hint, status conflicts", () => {
    const target = tempPiAgent();
    mkdirSync(join(target, "skills"), { recursive: true });
    writeFileSync(join(target, "skills", "accord"), "user content", "utf8");

    const { host, events } = captureNotifies();
    const r = maybeAutoInstallAssets(host, { target, env: {} });

    expect(r.status).toBe("conflicts");
    expect(r.conflicts).toBeGreaterThan(0);
    expect(events).toHaveLength(1);
    expect(events[0].level).toBe("warning");
    expect(events[0].message).toMatch(/--force/);
  });

  test("missing manifest (broken package root) → warns and returns error", () => {
    const target = tempPiAgent();
    const brokenRoot = tempPiAgent(); // empty dir, no assets/manifest.json
    const { host, events } = captureNotifies();

    const r = maybeAutoInstallAssets(host, { target, packageRoot: brokenRoot, env: {} });

    expect(r.status).toBe("error");
    expect(events).toHaveLength(1);
    expect(events[0].level).toBe("warning");
    expect(events[0].message).toMatch(/cannot read bundled manifest/);
  });

  test("subsequent silent calls do not re-notify after a successful install", () => {
    const target = tempPiAgent();
    const { host: h1 } = captureNotifies();
    maybeAutoInstallAssets(h1, { target, env: {} });

    const { host: h2, events: e2 } = captureNotifies();
    const r = maybeAutoInstallAssets(h2, { target, env: {} });
    expect(r.status).toBe("current");
    expect(e2).toEqual([]);
  });

  test("installed metadata symlink survives across two bootstraps and resolves to the package assets dir", () => {
    const target = tempPiAgent();
    maybeAutoInstallAssets({ notify: () => {} }, { target, env: {} });

    const skillSymlink = join(target, "skills", "accord");
    const linkTarget = readlinkSync(skillSymlink);
    expect(linkTarget).toContain("assets/skills/accord");
  });

  test("first install via the bootstrap also seeds accord-config.json", () => {
    const target = tempPiAgent();
    maybeAutoInstallAssets({ notify: () => {} }, { target, env: {} });
    expect(existsSync(join(target, "accord-config.json"))).toBe(true);
  });

  test("opt-out (env=false) does not seed accord-config.json", () => {
    const target = tempPiAgent();
    maybeAutoInstallAssets(
      { notify: () => {} },
      { target, env: { ACCORD_AUTO_INSTALL_ASSETS: "false" } },
    );
    expect(existsSync(join(target, "accord-config.json"))).toBe(false);
  });
});

// ── Global config seed + JSONC stripping ────────────────────

describe("seedGlobalConfigFile", () => {
  test("creates accord-config.json with commented examples in a fresh target", () => {
    const target = tempPiAgent();
    const result = seedGlobalConfigFile({ target });

    expect(result.status).toBe("created");
    const raw = readFileSync(result.path, "utf8");
    expect(raw).toContain("// ACCORD global configuration");
    expect(raw).toContain('"auto_install": true');
    expect(raw).toContain('"context_sources"');
    expect(raw).toContain('"providers"');
    // Stripping comments must yield the empty object — no field is
    // active by default.
    expect(JSON.parse(stripJsonComments(raw))).toEqual({});
  });

  test("does not overwrite an existing config", () => {
    const target = tempPiAgent();
    const path = join(target, "accord-config.json");
    mkdirSync(target, { recursive: true });
    writeFileSync(path, '{ "context_sources": [] }', "utf8");

    const result = seedGlobalConfigFile({ target });
    expect(result.status).toBe("exists");
    expect(readFileSync(path, "utf8")).toBe('{ "context_sources": [] }');
  });

  test("uses custom content when provided", () => {
    const target = tempPiAgent();
    const result = seedGlobalConfigFile({ target, content: "// hi\n{}\n" });
    expect(result.status).toBe("created");
    expect(readFileSync(result.path, "utf8")).toBe("// hi\n{}\n");
  });
});

describe("stripJsonComments", () => {
  test("removes // line comments and /* block comments */ but preserves strings", () => {
    const input = `// header\n{\n  "a": 1, // trailing\n  /* block */ "b": "// not a comment",\n  "c": "/* still text */"\n}`;
    const stripped = stripJsonComments(input);
    expect(JSON.parse(stripped)).toEqual({
      a: 1,
      b: "// not a comment",
      c: "/* still text */",
    });
  });

  test("default template parses to an empty object", () => {
    const stripped = stripJsonComments(defaultGlobalConfigTemplate());
    expect(JSON.parse(stripped)).toEqual({});
  });
});
