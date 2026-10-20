#!/usr/bin/env bun
/**
 * Lints prose in markdown files marked `style: ste` in frontmatter against a subset of
 * ASD-STE100 (sentence length, paragraph length, banned words, contractions, passive and
 * progressive forms). Code blocks, inline code, tables, headings, and frontmatter are skipped.
 *
 * Usage: `bun scripts/validate-ste.ts [file ...]` (default: every `okf/**\/*.md` and
 * `packages/pi-skills/skills/**\/SKILL.md` that opts in). Exit 1 on any finding.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const MAX_SENTENCE_WORDS = 20;
const MAX_STEP_WORDS = 25;
const MAX_PARAGRAPH_SENTENCES = 6;

const BANNED: Record<string, string> = {
  utilize: "use",
  utilise: "use",
  leverage: "use",
  initiate: "start",
  commence: "start",
  terminate: "stop",
  ensure: "make sure",
  "prior to": "before",
  "in order to": "to",
  subsequently: "then",
  approximately: "about",
  should: "must",
  may: "can",
  might: "can",
};

const PASSIVE =
  /\b(is|are|was|were|be|been|being)\s+(\w+ed|written|run|made|done|given|shown|set|seen|taken|kept|known)\b/i;
const PROGRESSIVE = /\b(is|are|was|were|am|been|being)\s+\w+ing\b/i;
const CONTRACTION = /\b\w+['’](t|s|re|ve|ll|d|m)\b/i;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".worktrees" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (entry.endsWith(".md")) out.push(full);
  }
  return out;
}

function splitFrontmatter(text: string): { frontmatter: string; body: string } {
  if (!text.startsWith("---\n")) return { frontmatter: "", body: text };
  const end = text.indexOf("\n---", 4);
  if (end === -1) return { frontmatter: "", body: text };
  return { frontmatter: text.slice(4, end), body: text.slice(end + 4) };
}

type Block = { text: string; isStep: boolean; line: number };

/** Prose blocks (paragraphs and list items) with code, tables, and headings removed. */
function proseBlocks(body: string, firstLine: number): Block[] {
  const blocks: Block[] = [];
  let inFence = false;
  let current: Block | null = null;
  const flush = (): void => {
    if (current?.text.trim()) blocks.push(current);
    current = null;
  };
  for (const [index, raw] of body.split("\n").entries()) {
    const lineNumber = firstLine + index;
    if (/^\s*```/.test(raw)) {
      inFence = !inFence;
      flush();
      continue;
    }
    if (inFence || /^\s*(\||#|---|<!--)/.test(raw) || !raw.trim()) {
      flush();
      continue;
    }
    const item = /^\s*(?:[-*]|\d+\.)\s+(.*)$/.exec(raw);
    const text = (item ? item[1] : raw.trim()) ?? "";
    if (item) {
      flush();
      current = { text, isStep: true, line: lineNumber };
    } else if (current) {
      current.text += ` ${text}`;
    } else {
      current = { text, isStep: false, line: lineNumber };
    }
  }
  flush();
  return blocks;
}

function clean(text: string): string {
  return text
    .replace(/`[^`]*`/g, "CODE")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_]{1,2}/g, "")
    .replace(/\b(e\.g|i\.e|etc|vs)\./gi, "$1");
}

function lintFile(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const { frontmatter, body } = splitFrontmatter(text);
  if (!/^style:\s*ste\s*$/m.test(frontmatter)) return [];
  const bodyStart = text.slice(0, text.length - body.length).split("\n").length;
  const rel = relative(repoRoot, file);
  const findings: string[] = [];
  for (const block of proseBlocks(body, bodyStart)) {
    const sentences = clean(block.text)
      .split(/(?<=[.!?:])\s+(?=[A-Z])/)
      .map((sentence) => sentence.trim())
      .filter(Boolean);
    if (sentences.length > MAX_PARAGRAPH_SENTENCES) {
      findings.push(
        `${rel}:${block.line} paragraph has ${sentences.length} sentences (max ${MAX_PARAGRAPH_SENTENCES})`,
      );
    }
    for (const sentence of sentences) {
      const words = sentence.split(/\s+/).length;
      const max = block.isStep ? MAX_STEP_WORDS : MAX_SENTENCE_WORDS;
      const where = `${rel}:${block.line}`;
      if (words > max)
        findings.push(`${where} ${words} words (max ${max}): "${sentence.slice(0, 60)}…"`);
      for (const [word, fix] of Object.entries(BANNED)) {
        if (new RegExp(`\\b${word}\\b`, "i").test(sentence)) {
          findings.push(`${where} avoid "${word}", use "${fix}"`);
        }
      }
      if (CONTRACTION.test(sentence))
        findings.push(`${where} contraction in "${sentence.slice(0, 50)}"`);
      if (PROGRESSIVE.test(sentence))
        findings.push(`${where} progressive tense in "${sentence.slice(0, 50)}"`);
      else if (PASSIVE.test(sentence))
        findings.push(`${where} possible passive voice in "${sentence.slice(0, 50)}"`);
    }
  }
  return findings;
}

const args = process.argv.slice(2);
const files = args.length
  ? args.map((arg) => resolve(arg))
  : [...walk(join(repoRoot, "okf")), ...walk(join(repoRoot, "packages", "pi-skills", "skills"))];
const findings = files.flatMap(lintFile);
if (findings.length) {
  console.error(`ste lint failed (${findings.length} finding(s)):`);
  for (const finding of findings) console.error(`  - ${finding}`);
  process.exit(1);
}
console.log("ste lint passed");
