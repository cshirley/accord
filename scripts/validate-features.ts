#!/usr/bin/env bun
/**
 * Validates feature docs (anchors, links, AC test references, AC count) and regenerates
 * `index.md` / `index.json`. Thin CLI over `validateFeatures` and `generateFeatureIndex`.
 *
 * Usage: `bun scripts/validate-features.ts [--root <repoDir>]`. Exit 1 on any error.
 * Without `--root` the repo is the cwd and the check runs only when `knowledge.enabled` is set.
 */

import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { loadDevHarnessConfig } from "../packages/accord-core/src/config/agents-md.js";
import { resolveKnowledgeConfig } from "../packages/accord-core/src/config/stack-flags.js";
import { validateFeatures } from "../packages/accord-core/src/knowledge/feature-doc.js";
import { generateFeatureIndex } from "../packages/accord-core/src/knowledge/index-gen.js";

const usage = "usage: validate-features [--root <repoDir>]";
const args = process.argv.slice(2);
let explicitRoot: string | undefined;
if (args.length === 2 && args[0] === "--root" && !args[1].startsWith("--")) {
  explicitRoot = args[1];
} else if (args.length > 0) {
  console.error(`validate-features: invalid arguments; ${usage}`);
  process.exit(1);
}

const repoRoot = resolve(explicitRoot ?? process.cwd());
const knowledge = resolveKnowledgeConfig(loadDevHarnessConfig(repoRoot));

if (!explicitRoot && !knowledge.enabled) {
  console.log("validate-features: knowledge.enabled is not set; skipped");
  process.exit(0);
}

const docRoot = resolve(repoRoot, knowledge.root);
const rel = relative(repoRoot, docRoot);
if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
  console.error(
    `validate-features: knowledge.root must be a subdirectory inside the repo: ${knowledge.root}`,
  );
  process.exit(1);
}
if (!existsSync(docRoot)) {
  if (explicitRoot) {
    console.error(`validate-features: features directory not found: ${knowledge.root}`);
    process.exit(1);
  }
  console.log("validate-features: no feature docs yet; skipped");
  process.exit(0);
}

const options = {
  repoRoot,
  root: rel,
  maxAcsPerFeature: knowledge.max_acs_per_feature,
};
const result = validateFeatures(options);
if (!result.ok) {
  console.error(`validate-features: ${result.errors.length} problem(s)`);
  for (const error of result.errors)
    console.error(`  ${error.feature}: ${error.code}: ${error.message}`);
  process.exit(1);
}

generateFeatureIndex({ repoRoot, root: rel });
console.log("validate-features: ok");
