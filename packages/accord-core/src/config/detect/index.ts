import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { findGitRoot } from "../git.js";
import { loadGlobalConfig, mergeContextSources } from "../global.js";
import { LANG_PROFILES_DIR } from "../paths.js";
import type { BuildResult, DevHarnessConfig, LangProfile, TrackerType } from "../types.js";

// ── Lang-profile loading ───────────────────────────────────

function loadLangProfile(language: string): LangProfile | null {
  const profilePath = path.join(LANG_PROFILES_DIR, `${language}.json`);
  if (!fs.existsSync(profilePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(profilePath, "utf8"));
  } catch {
    return null;
  }
}

// ── Project stack detection ────────────────────────────────

const MARKER_MAP: [string, string][] = [
  ["Cargo.toml", "rust"],
  ["go.mod", "go"],
  ["pyproject.toml", "python"],
  ["setup.py", "python"],
  ["requirements.txt", "python"],
  ["Gemfile", "ruby"],
  ["pom.xml", "java"],
  ["build.gradle", "java"],
  ["build.gradle.kts", "java"],
  ["package.json", "typescript"],
];

export function detectProjectStack(dir: string): { language: string; detect_file: string } | null {
  // .csproj / .sln (glob-like)
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith(".csproj") || f.endsWith(".sln")) {
        return { language: "csharp", detect_file: f };
      }
    }
  } catch {
    /* ignore */
  }

  for (const [marker, lang] of MARKER_MAP) {
    if (!fs.existsSync(path.join(dir, marker))) continue;
    if (marker === "package.json") {
      const hasTsConfig = fs.existsSync(path.join(dir, "tsconfig.json"));
      let hasTsDep = false;
      try {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
        hasTsDep = !!(pkg.devDependencies?.typescript || pkg.dependencies?.typescript);
      } catch {
        /* ignore */
      }
      return {
        language: hasTsConfig || hasTsDep ? "typescript" : "javascript",
        detect_file: marker,
      };
    }
    return { language: lang, detect_file: marker };
  }
  return null;
}

// ── Monorepo detection ─────────────────────────────────────

const MONOREPO_MARKERS: [string, string][] = [
  ["nx.json", "nx"],
  ["turbo.json", "turbo"],
  ["lerna.json", "lerna"],
  ["pnpm-workspace.yaml", "pnpm workspaces"],
  ["go.work", "go workspaces"],
];

const MONOREPO_ROOT_MARKERS = [
  "nx.json",
  "turbo.json",
  "lerna.json",
  "pnpm-workspace.yaml",
  "go.work",
];

const MONOREPO_MARKER_TO_TOOL: Record<string, string> = {
  "nx.json": "nx",
  "turbo.json": "turbo",
  "lerna.json": "lerna",
  "pnpm-workspace.yaml": "pnpm workspaces",
  "go.work": "go workspaces",
};

export function detectMonorepo(dir: string): { tool: string; root: string } | null {
  for (const [file, tool] of MONOREPO_MARKERS) {
    if (fs.existsSync(path.join(dir, file))) return { tool, root: "." };
  }
  // Cargo workspaces
  const cargoToml = path.join(dir, "Cargo.toml");
  if (fs.existsSync(cargoToml)) {
    try {
      if (/\[workspace\]/.test(fs.readFileSync(cargoToml, "utf8"))) {
        return { tool: "cargo workspaces", root: "." };
      }
    } catch {
      /* ignore */
    }
  }
  // npm/yarn workspaces
  const pkgPath = path.join(dir, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      if (JSON.parse(fs.readFileSync(pkgPath, "utf8")).workspaces) {
        return { tool: "npm/yarn workspaces", root: "." };
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

/**
 * Walk from `from` up to git root looking for monorepo markers.
 * Returns the directory containing the marker + the detected tool, or null.
 */
export function findMonorepoRoot(from: string): { root: string; tool: string } | null {
  const gitRoot = findGitRoot(from);
  let dir = path.resolve(from);
  const stopAt = gitRoot ? path.resolve(gitRoot) : null;

  while (true) {
    for (const marker of MONOREPO_ROOT_MARKERS) {
      if (fs.existsSync(path.join(dir, marker))) {
        return { root: dir, tool: MONOREPO_MARKER_TO_TOOL[marker] ?? marker };
      }
    }
    // Cargo.toml [workspace]
    const cargoToml = path.join(dir, "Cargo.toml");
    if (fs.existsSync(cargoToml)) {
      try {
        if (/\[workspace\]/.test(fs.readFileSync(cargoToml, "utf8"))) {
          return { root: dir, tool: "cargo workspaces" };
        }
      } catch {
        /* ignore */
      }
    }
    // npm/yarn workspaces in package.json
    const pkgPath = path.join(dir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        if (JSON.parse(fs.readFileSync(pkgPath, "utf8")).workspaces) {
          return { root: dir, tool: "npm/yarn workspaces" };
        }
      } catch {
        /* ignore */
      }
    }

    if (stopAt && dir === stopAt) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// ── Tracker detection ───────────────────────────────────────

/**
 * Detect the issue tracker from git remote URL and project signals.
 * Returns null if detection is ambiguous (the /dev init flow will ask the user).
 */
export function detectTracker(dir: string): { type: TrackerType; project_prefix?: string } | null {
  // Try reading git remote origin URL
  let remoteUrl = "";
  try {
    remoteUrl = execSync("git config --get remote.origin.url", {
      cwd: dir,
      stdio: ["pipe", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    /* not a git repo or no remote */
  }

  if (remoteUrl) {
    if (remoteUrl.includes("github.com")) return { type: "github" };
    if (remoteUrl.includes("gitlab.com") || remoteUrl.includes("gitlab")) return { type: "gitlab" };
  }

  // Check for Jira-specific signals
  if (fs.existsSync(path.join(dir, ".jira"))) return { type: "jira" };

  // Check existing work items for ID prefix pattern
  const tasksDir = path.join(dir, ".tasks");
  if (fs.existsSync(tasksDir)) {
    try {
      const files = fs.readdirSync(tasksDir).filter((f) => f.endsWith(".json") && !f.includes("-"));
      for (const file of files) {
        const content = fs.readFileSync(path.join(tasksDir, file), "utf8");
        const match = content.match(/"id"\s*:\s*"([A-Z]+(?:-[A-Z]+)*)-\d+"/);
        if (match) return { type: "jira", project_prefix: match[1] };
      }
    } catch {
      /* ignore */
    }
  }

  return null;
}

// ── Binary detection ───────────────────────────────────────

function hasBinary(name: string): boolean {
  try {
    execSync(`command -v ${name}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// ── Per-language project inference ─────────────────────────

function inferProjectConfig(
  dir: string,
  language: string,
  notes: string[],
): Partial<DevHarnessConfig> {
  const config: Partial<DevHarnessConfig> = {};

  switch (language) {
    case "typescript":
    case "javascript":
      inferNodeProject(dir, language, config, notes);
      break;
    case "go":
      inferGoProject(dir, config, notes);
      break;
    case "rust":
      inferRustProject(config, notes);
      break;
    case "python":
      inferPythonProject(dir, config, notes);
      break;
    case "ruby":
      inferRubyProject(dir, config, notes);
      break;
    case "java":
      inferJavaProject(dir, config, notes);
      break;
    case "csharp":
      inferCsharpProject(config, notes);
      break;
  }

  applyMakefileOverrides(dir, config, notes);
  return config;
}

function inferNodeProject(
  dir: string,
  language: string,
  config: Partial<DevHarnessConfig>,
  notes: string[],
): void {
  const pkgPath = path.join(dir, "package.json");
  if (!fs.existsSync(pkgPath)) return;
  let pkg: Record<string, unknown>;
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as Record<string, unknown>;
  } catch {
    return;
  }
  const scripts =
    typeof pkg.scripts === "object" && pkg.scripts !== null
      ? (pkg.scripts as Record<string, unknown>)
      : {};
  const deps = {
    ...(typeof pkg.dependencies === "object" && pkg.dependencies !== null
      ? (pkg.dependencies as Record<string, unknown>)
      : {}),
    ...(typeof pkg.devDependencies === "object" && pkg.devDependencies !== null
      ? (pkg.devDependencies as Record<string, unknown>)
      : {}),
  };

  const pmCmd = fs.existsSync(path.join(dir, "pnpm-lock.yaml"))
    ? "pnpm"
    : fs.existsSync(path.join(dir, "yarn.lock"))
      ? "yarn"
      : fs.existsSync(path.join(dir, "bun.lockb")) || fs.existsSync(path.join(dir, "bun.lock"))
        ? "bun"
        : "npm";
  const run = pmCmd === "npm" ? "npm run" : pmCmd;
  notes.push(`Package manager: ${pmCmd} (lockfile)`);

  // Test
  const runner = deps.vitest ? "vitest" : deps.jest ? "jest" : deps.mocha ? "mocha" : null;
  if (scripts.test) {
    config.test = { command: `${run} test` };
    notes.push(`Test: '${run} test' (from scripts.test)`);
  } else if (runner) {
    config.test = { command: `npx ${runner}` };
    notes.push(`Test: 'npx ${runner}' (${runner} in devDeps, no test script)`);
  }
  if (config.test) {
    if (runner === "vitest" || runner === "jest") config.test.single_test_flag = "-t";
    else if (runner === "mocha") config.test.single_test_flag = "--grep";
  }

  // Type check
  const tcScript = ["typecheck", "type-check", "types", "tsc"].find((s) => scripts[s]);
  if (tcScript) {
    config.type_check = `${run} ${tcScript}`;
    notes.push(`Type check: '${run} ${tcScript}' (from scripts.${tcScript})`);
  } else if (language === "typescript") {
    config.type_check = "npx tsc --noEmit";
    notes.push("Type check: 'npx tsc --noEmit' (TS project, no typecheck script)");
  }

  // Lint
  const lintScript = ["lint", "lint:check", "check:biome"].find((s) => scripts[s]);
  if (lintScript) {
    config.lint = `${run} ${lintScript}`;
    notes.push(`Lint: '${run} ${lintScript}' (from scripts.${lintScript})`);
  } else if (deps.biome || deps["@biomejs/biome"]) {
    config.lint = "npx biome check";
    notes.push("Lint: 'npx biome check' (biome in deps, no lint script)");
  } else if (deps.eslint) {
    config.lint = "npx eslint .";
    notes.push("Lint: 'npx eslint .' (eslint in deps, no lint script)");
  }

  // Format
  const fmtScript = ["format", "format:check"].find((s) => scripts[s]);
  if (fmtScript) {
    config.format = `${run} ${fmtScript}`;
    notes.push(`Format: '${run} ${fmtScript}' (from scripts.${fmtScript})`);
  } else if (deps.biome || deps["@biomejs/biome"]) {
    config.format = "npx biome format --check";
    notes.push("Format: 'npx biome format --check' (biome in deps)");
  } else if (deps.prettier) {
    config.format = "npx prettier --check .";
    notes.push("Format: 'npx prettier --check .' (prettier in deps)");
  }
}

function inferGoProject(_dir: string, config: Partial<DevHarnessConfig>, notes: string[]): void {
  config.test = { command: "go test ./...", single_test_flag: "-run" };
  config.type_check = "go vet ./...";
  notes.push("Test: 'go test ./...' (Go default)");
  notes.push("Type check: 'go vet ./...' (Go default)");
  if (hasBinary("golangci-lint")) {
    config.lint = "golangci-lint run";
    notes.push("Lint: 'golangci-lint run' (binary found in PATH)");
  }
  if (hasBinary("gofumpt")) {
    config.format = "gofumpt -l .";
    notes.push("Format: 'gofumpt -l .' (binary found in PATH)");
  } else {
    config.format = "gofmt -l .";
    notes.push("Format: 'gofmt -l .' (gofumpt not found, using gofmt)");
  }
}

function inferRustProject(config: Partial<DevHarnessConfig>, notes: string[]): void {
  config.test = { command: "cargo test" };
  config.type_check = "cargo check --all-targets";
  config.lint = "cargo clippy -- -D warnings";
  config.format = "cargo fmt --check";
  notes.push("Rust project — using cargo defaults (test/check/clippy/fmt)");
}

function inferPythonProject(dir: string, config: Partial<DevHarnessConfig>, notes: string[]): void {
  let pyproject = "";
  try {
    pyproject = fs.readFileSync(path.join(dir, "pyproject.toml"), "utf8");
  } catch {
    /* ok */
  }

  if (
    pyproject.includes("[tool.pytest") ||
    fs.existsSync(path.join(dir, "pytest.ini")) ||
    hasBinary("pytest")
  ) {
    config.test = { command: "pytest", single_test_flag: "-k" };
    notes.push("Test: 'pytest' (pytest config or binary found)");
  }

  if (pyproject.includes("[tool.mypy") || fs.existsSync(path.join(dir, "mypy.ini"))) {
    config.type_check = "mypy .";
    notes.push("Type check: 'mypy .' (mypy config found)");
  } else if (
    pyproject.includes("[tool.pyright") ||
    fs.existsSync(path.join(dir, "pyrightconfig.json"))
  ) {
    config.type_check = "pyright";
    notes.push("Type check: 'pyright' (pyright config found)");
  } else if (hasBinary("mypy")) {
    config.type_check = "mypy .";
    notes.push("Type check: 'mypy .' (binary found in PATH)");
  }

  if (pyproject.includes("[tool.ruff") || hasBinary("ruff")) {
    config.lint = "ruff check .";
    config.format = "ruff format --check .";
    notes.push("Lint+Format: ruff (config or binary found)");
  } else if (hasBinary("flake8")) {
    config.lint = "flake8 .";
    notes.push("Lint: 'flake8 .' (binary found in PATH)");
  }
}

function inferRubyProject(dir: string, config: Partial<DevHarnessConfig>, notes: string[]): void {
  const hasRspec = fs.existsSync(path.join(dir, ".rspec")) || fs.existsSync(path.join(dir, "spec"));
  config.test = hasRspec
    ? { command: "bundle exec rspec", single_test_flag: "-e" }
    : { command: "bundle exec rake test" };
  notes.push(
    `Test: '${config.test.command}' (${hasRspec ? ".rspec/spec found" : "rake fallback"})`,
  );
  if (hasBinary("rubocop")) {
    config.lint = "rubocop";
    config.format = "rubocop --auto-correct-all --fail-level error";
    notes.push("Lint+Format: rubocop (binary found in PATH)");
  }
}

function inferJavaProject(dir: string, config: Partial<DevHarnessConfig>, notes: string[]): void {
  if (fs.existsSync(path.join(dir, "gradlew"))) {
    config.test = { command: "./gradlew test", single_test_flag: "--tests" };
    notes.push("Test: './gradlew test' (gradlew wrapper found)");
    if (fs.existsSync(path.join(dir, "config", "checkstyle"))) {
      config.lint = "./gradlew checkstyleMain";
      notes.push("Lint: './gradlew checkstyleMain' (checkstyle config found)");
    }
  } else if (fs.existsSync(path.join(dir, "mvnw"))) {
    config.test = { command: "./mvnw test", single_test_flag: "-Dtest=" };
    notes.push("Test: './mvnw test' (mvnw wrapper found)");
  } else if (fs.existsSync(path.join(dir, "pom.xml"))) {
    config.test = { command: "mvn test", single_test_flag: "-Dtest=" };
    notes.push("Test: 'mvn test' (pom.xml found)");
  } else if (
    fs.existsSync(path.join(dir, "build.gradle")) ||
    fs.existsSync(path.join(dir, "build.gradle.kts"))
  ) {
    config.test = { command: "gradle test", single_test_flag: "--tests" };
    notes.push("Test: 'gradle test' (build.gradle found, no wrapper)");
  }
}

function inferCsharpProject(config: Partial<DevHarnessConfig>, notes: string[]): void {
  config.test = { command: "dotnet test", single_test_flag: "--filter" };
  config.type_check = "dotnet build --no-restore";
  config.lint = "dotnet format --verify-no-changes";
  notes.push(".NET project — using dotnet defaults (test/build/format)");
}

function applyMakefileOverrides(
  dir: string,
  config: Partial<DevHarnessConfig>,
  notes: string[],
): void {
  const makefilePath = path.join(dir, "Makefile");
  if (!fs.existsSync(makefilePath)) return;
  try {
    const makefile = fs.readFileSync(makefilePath, "utf8");
    const targets = new Set(
      [...makefile.matchAll(/^([a-zA-Z_][a-zA-Z0-9_-]*)\s*:/gm)].map((m) => m[1]),
    );
    const overrides: string[] = [];
    if (targets.has("test")) {
      config.test = { ...(config.test ?? {}), command: "make test" };
      overrides.push("test");
    }
    if (targets.has("lint")) {
      config.lint = "make lint";
      overrides.push("lint");
    }
    if (targets.has("check") && !config.type_check) {
      config.type_check = "make check";
      overrides.push("check");
    }
    if (targets.has("fmt") || targets.has("format")) {
      config.format = targets.has("fmt") ? "make fmt" : "make format";
      overrides.push("format");
    }
    if (overrides.length > 0) {
      notes.push(`Makefile overrides: ${overrides.join(", ")}`);
    }
  } catch {
    /* ignore */
  }
}

// ── Config builder ─────────────────────────────────────────

/**
 * Build a complete DevHarnessConfig:
 *   1. Project-specific inference (highest priority)
 *   2. Lang-profile defaults (fills gaps)
 *   3. Hardcoded sensible defaults (last resort)
 *
 * Returns the config + human-readable detection notes, or null if no project found.
 */
export function buildDevHarnessConfig(dir: string): BuildResult | null {
  const detected = detectProjectStack(dir);
  if (!detected) return null;

  const notes: string[] = [];
  const { language, detect_file } = detected;
  notes.push(`Detected language: ${language} (from ${detect_file})`);

  const inferred = inferProjectConfig(dir, language, notes);
  const profile = loadLangProfile(language);
  if (profile) notes.push(`Loaded lang-profile: ${language}.json`);

  const mono =
    detectMonorepo(dir) ??
    (() => {
      const found = findMonorepoRoot(dir);
      if (!found) return null;
      const rel = path.relative(dir, found.root);
      return { tool: found.tool, root: rel || "." };
    })();
  if (mono) notes.push(`Monorepo: ${mono.tool} (root: ${mono.root ?? "."})`);

  const test: DevHarnessConfig["test"] = {
    command: inferred.test?.command ?? profile?.checks?.test ?? "echo 'No test command configured'",
    single_test_flag: inferred.test?.single_test_flag ?? profile?.test_meta?.single_test_flag,
    file_pattern: inferred.test?.file_pattern ?? profile?.test_meta?.file_pattern,
    block_markers: inferred.test?.block_markers ?? profile?.test_meta?.block_markers,
  };

  // Note when lang-profile filled gaps
  if (!inferred.test?.single_test_flag && profile?.test_meta?.single_test_flag) {
    notes.push(`single_test_flag: '${profile.test_meta.single_test_flag}' (from lang-profile)`);
  }
  if (!inferred.test?.file_pattern && profile?.test_meta?.file_pattern) {
    notes.push(`file_pattern: '${profile.test_meta.file_pattern}' (from lang-profile)`);
  }

  const type_check =
    inferred.type_check !== undefined ? inferred.type_check : (profile?.checks?.type_check ?? null);
  const lint = inferred.lint !== undefined ? inferred.lint : (profile?.checks?.lint ?? null);
  const format =
    inferred.format !== undefined ? inferred.format : (profile?.checks?.format ?? null);

  const verification_commands: string[] = inferred.verification_commands ?? [];
  if (verification_commands.length === 0) {
    if (type_check) verification_commands.push(type_check);
    if (lint) verification_commands.push(lint);
    verification_commands.push(test.command);
    notes.push(
      `verification_commands: composed from type_check + lint + test (${verification_commands.length} commands)`,
    );
  }

  const config: DevHarnessConfig = {
    schema_version: "1.0",
    language,
    detect_file,
    test,
    type_check,
    lint,
    format,
    verification_commands,
  };
  if (mono) config.monorepo = mono;

  const tracker = detectTracker(dir);
  if (tracker) {
    config.tracker = tracker;
    const prefix = tracker.project_prefix ? ` (prefix: ${tracker.project_prefix})` : "";
    notes.push(`Tracker: ${tracker.type}${prefix}`);
  } else {
    notes.push("Tracker: not detected (will ask user)");
  }

  // Merge global + project context sources (project sources will be empty at
  // build time — they're only populated after the user runs /dev init and edits
  // AGENTS.md. But we load global defaults so the built config is enrichment-ready).
  const globalCfg = loadGlobalConfig();
  const mergedSources = mergeContextSources(globalCfg?.context_sources, undefined);
  if (mergedSources.length > 0) config.context_sources = mergedSources;

  // Strip undefined optional fields
  if (config.test) {
    const t: DevHarnessConfig["test"] = { ...config.test };
    if (!t.single_test_flag) t.single_test_flag = undefined;
    if (!t.file_pattern) t.file_pattern = undefined;
    if (!t.block_markers) t.block_markers = undefined;
    config.test = t;
  }

  return { config, notes };
}
