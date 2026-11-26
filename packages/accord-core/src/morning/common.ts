/**
 * Shared journal path resolution and line-normalisation helpers.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

export interface JournalItem {
  raw: string;
  checkbox: string;
  text: string;
  jiraKey?: string;
  badges: string[];
}

export function resolveJournalPath(): string {
  if (process.env.JOURNAL_DIR) {
    const p = resolve(process.env.JOURNAL_DIR, "work-journal.md");
    if (existsSync(p)) return p;
  }
  const fallback = resolve(
    process.env.HOME || "~",
    "src/github.com/cshirley/documentation/work-journal.md",
  );
  if (existsSync(fallback)) return fallback;
  throw new Error("Cannot locate work-journal.md. Set $JOURNAL_DIR or check the path.");
}

export function parseItem(line: string): JournalItem | null {
  const m = line.match(/^- \[([ x~>-])\]\s+(.*)/);
  if (!m) return null;
  const checkbox = `[${m[1]}]`;
  const text = m[2];
  const jiraMatch = text.match(/\b(STEP|BDPC|CR|THMC|CLD)-\d+\b/);
  const badges = [...text.matchAll(/`([^`]+)`/g)].map((b) => b[1]);
  return { raw: line, checkbox, text, jiraKey: jiraMatch?.[0], badges };
}

export function getMonday(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function normalizeItemLine(line: string): string {
  const trimmed = line.trimEnd();
  if (!trimmed.trim()) return line;
  if (/^- \[[ x~>-]\]/.test(trimmed)) return trimmed;
  const bareCheckbox = trimmed.replace(/^- /, "").match(/^\[([ x~>-])\]\s*(.*)$/);
  if (bareCheckbox) return `- [${bareCheckbox[1]}] ${bareCheckbox[2]}`;
  if (trimmed.startsWith("- ")) return `- [ ] ${trimmed.slice(2)}`;
  return `- [ ] ${trimmed.trimStart()}`;
}

export function normalizeItems(items: string[]): string[] {
  return items.map((item) => {
    const lines = item.split("\n");
    if (!lines.length) return item;
    lines[0] = normalizeItemLine(lines[0]);
    return lines.join("\n");
  });
}
