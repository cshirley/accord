#!/usr/bin/env bun
/**
 * Fast inner-loop check: runs Biome and tests only for files changed vs HEAD
 * (staged, unstaged, untracked). Run `bun run check` once before commit.
 *
 * Flags: --types  also run `tsc --noEmit`
 */
import { existsSync } from "node:fs";

const run = (cmd: string[]): string =>
  new TextDecoder().decode(Bun.spawnSync(cmd, { stdout: "pipe", stderr: "pipe" }).stdout);

const changedFiles = [
  ...new Set(
    [
      ...run(["git", "diff", "--name-only", "HEAD"]).split("\n"),
      ...run(["git", "ls-files", "--others", "--exclude-standard"]).split("\n"),
    ].filter((path) => path && existsSync(path)),
  ),
];

const biomeFiles = changedFiles.filter((path) => /\.(ts|tsx|js|mjs|json|jsonc)$/.test(path));
const testFiles = changedFiles.filter((path) => path.endsWith(".test.ts"));
const sourcePackages = new Set(
  changedFiles
    .filter((path) => /^packages\/[^/]+\/src\//.test(path))
    .map((path) => path.split("/").slice(0, 2).join("/")),
);

const steps: Array<{ name: string; cmd: string[] }> = [];
if (biomeFiles.length > 0)
  steps.push({ name: "biome", cmd: ["bunx", "biome", "check", ...biomeFiles] });
if (testFiles.length > 0)
  steps.push({ name: "tests (changed)", cmd: ["bun", "test", ...testFiles] });
for (const pkg of sourcePackages) {
  if (existsSync(`${pkg}/tests`))
    steps.push({ name: `tests (${pkg})`, cmd: ["bun", "test", `${pkg}/tests`] });
}
if (changedFiles.some((path) => path.startsWith("okf/") || path === "AGENTS.md"))
  steps.push({ name: "validate:okf", cmd: ["bun", "scripts/validate-okf.ts"] });
if (process.argv.includes("--types"))
  steps.push({ name: "types", cmd: ["bunx", "tsc", "--noEmit"] });

if (steps.length === 0) {
  console.log("check:changed — nothing to check");
  process.exit(0);
}

let failed = false;
for (const step of steps) {
  console.log(`\n▶ ${step.name}`);
  const result = Bun.spawnSync(step.cmd, { stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) failed = true;
}
console.log(
  failed
    ? "\ncheck:changed FAILED (run `bun run check` before commit)"
    : "\ncheck:changed ok (run `bun run check` before commit)",
);
process.exit(failed ? 1 : 0);
