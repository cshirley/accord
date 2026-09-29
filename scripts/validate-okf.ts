#!/usr/bin/env bun
/**
 * Validates the OKF v0.2 knowledge bundle in `okf/` so it cannot silently drift from the repo:
 *
 * - every concept has frontmatter with `type`, `title`, `description`
 * - every `sources[].resource` repo path (`/path`) exists
 * - every markdown link resolves (`/x.md` → bundle-relative, `./x` / `../x` → file-relative)
 * - every concept is reachable from a section `index.md`
 *
 * Usage: `bun scripts/validate-okf.ts [bundleDir]` (default `okf`). Exit 1 on any error.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const bundleRoot = resolve(repoRoot, process.argv[2] ?? "okf");

/** Files that are bundle structure, not concepts. */
const STRUCTURAL = new Set(["index.md", "log.md"]);
const REQUIRED_CONCEPT_FIELDS = ["type", "title", "description"] as const;

function listMarkdown(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...listMarkdown(full));
    else if (entry.endsWith(".md")) out.push(full);
  }
  return out.sort();
}

function splitFrontmatter(text: string): { frontmatter: string | null; body: string } {
  if (!text.startsWith("---\n")) return { frontmatter: null, body: text };
  const end = text.indexOf("\n---", 4);
  if (end === -1) return { frontmatter: null, body: text };
  return { frontmatter: text.slice(4, end), body: text.slice(end + 4) };
}

function stripCode(body: string): string {
  // Links inside fenced/inline code are examples, not navigation.
  return body.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
}

function linkTargets(body: string): string[] {
  const targets: string[] = [];
  for (const match of stripCode(body).matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const target = match[1];
    if (target) targets.push(target);
  }
  return targets;
}

function resolveLink(fromFile: string, target: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith("#")) return null;
  const path = target.split("#")[0] ?? "";
  if (!path) return null;
  return path.startsWith("/") ? join(bundleRoot, path) : resolve(dirname(fromFile), path);
}

const errors: string[] = [];
const files = listMarkdown(bundleRoot);
const linkedFromIndex = new Set<string>();

for (const file of files) {
  const rel = relative(repoRoot, file);
  const name = file.split("/").pop() ?? "";
  const { frontmatter, body } = splitFrontmatter(readFileSync(file, "utf8"));
  const isConcept = !STRUCTURAL.has(name);

  if (isConcept) {
    if (!frontmatter) {
      errors.push(`${rel}: missing YAML frontmatter`);
    } else {
      for (const field of REQUIRED_CONCEPT_FIELDS) {
        if (!new RegExp(`^${field}:\\s*\\S`, "m").test(frontmatter)) {
          errors.push(`${rel}: frontmatter missing \`${field}\``);
        }
      }
    }
  }

  for (const match of (frontmatter ?? "").matchAll(/^\s*resource:\s*(\S+)\s*$/gm)) {
    const resource = match[1] ?? "";
    if (!resource.startsWith("/")) continue; // URLs are not checked offline
    if (!existsSync(join(repoRoot, resource))) {
      errors.push(`${rel}: sources resource not found: ${resource}`);
    }
  }

  for (const target of linkTargets(body)) {
    const resolved = resolveLink(file, target);
    if (!resolved) continue;
    if (!existsSync(resolved)) {
      errors.push(`${rel}: broken link ${target}`);
      continue;
    }
    if (name === "index.md") linkedFromIndex.add(resolved);
  }
}

for (const file of files) {
  const name = file.split("/").pop() ?? "";
  if (STRUCTURAL.has(name)) continue;
  if (!linkedFromIndex.has(file)) {
    errors.push(`${relative(repoRoot, file)}: not linked from any index.md (unreachable concept)`);
  }
}

if (errors.length > 0) {
  console.error(`okf validation failed (${String(errors.length)} error(s)):`);
  for (const error of errors) console.error(`  • ${error}`);
  process.exit(1);
}
console.log(`okf validation passed (${String(files.length)} files)`);
