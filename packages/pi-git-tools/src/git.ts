/**
 * Shared helpers — git/gh command execution, parsing, detection.
 */

import { execFile as execFileCb } from "node:child_process";
import { readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

// ── Command runners ─────────────────────────────────────────────────────────

/** Resolve the git repo root from any subdirectory. Cached per cwd. */
const rootCache = new Map<string, string>();

export async function gitRoot(cwd: string, signal?: AbortSignal): Promise<string> {
  const cached = rootCache.get(cwd);
  if (cached) return cached;
  const { stdout } = await execFile("git", ["rev-parse", "--show-toplevel"], { cwd, signal });
  const root = stdout.trim();
  rootCache.set(cwd, root);
  return root;
}

export async function git(args: string[], cwd: string, signal?: AbortSignal): Promise<string> {
  const { stdout } = await execFile("git", args, {
    cwd,
    signal,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

export async function gh(args: string[], cwd: string, signal?: AbortSignal): Promise<string> {
  const { stdout } = await execFile("gh", args, {
    cwd,
    signal,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

// ── Ticket extraction ───────────────────────────────────────────────────────

const TICKET_RE = /\b([A-Z][A-Z0-9]+(-[A-Z]+)*-\d+)\b/;

export const COMMIT_TYPE_PREFIXES = [
  "FEATURE",
  "FIX",
  "CONFIG",
  "DOCS",
  "TEST",
  "REFACTOR",
  "CHORE",
] as const;

export function extractTicket(text: string): string | null {
  return text.match(TICKET_RE)?.[1] ?? null;
}

// ── Secret detection ────────────────────────────────────────────────────────

const SECRET_PATTERNS = [
  /\.env($|\.)/,
  /\.pem$/,
  /\.key$/,
  /\.p12$/,
  /\.pfx$/,
  /credentials/i,
  /\.keystore$/,
  /id_rsa/,
  /id_ed25519/,
  /\.secret/,
  /token\.json$/i,
];

export function isSecretFile(path: string): boolean {
  return SECRET_PATTERNS.some((p) => p.test(path));
}

// ── Dev workflow artifact detection ─────────────────────────────────────────

const ARTIFACT_PATTERNS = [
  /^docs\/specs\/.*-spec-.*\.md$/,
  /^docs\/plans\/.*-plan-.*\.md$/,
  /^docs\/specs\/.*-verify-.*\.md$/,
];

export function isDevArtifact(path: string): boolean {
  return ARTIFACT_PATTERNS.some((p) => p.test(path));
}

// ── Frontmatter parsing ────────────────────────────────────────────────────

export function parseFrontmatter(content: string): Record<string, string> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const body = match[1];
  if (body === undefined) return null;
  const result: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const kv = line.match(/^(\w[\w-]*)\s*:\s*(.+)$/);
    if (kv) {
      const key = kv[1];
      const value = kv[2];
      if (key !== undefined && value !== undefined) {
        result[key] = value.trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  return result;
}

// ── Status path extraction ──────────────────────────────────────────────────

export function extractStatusPaths(output: string): string[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const path = line.slice(3);
      const arrow = path.indexOf(" -> ");
      return arrow >= 0 ? path.slice(arrow + 4) : path;
    });
}

// ── Diff / text truncation ──────────────────────────────────────────────────

export function truncateLines(
  text: string,
  maxLines: number,
): [text: string, truncated: boolean, totalLines: number] {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return [text, false, lines.length];
  return [
    lines.slice(0, maxLines).join("\n") +
      `\n\n... truncated (${lines.length - maxLines} more lines)`,
    true,
    lines.length,
  ];
}

// ── Artifact reading ────────────────────────────────────────────────────────

export interface ArtifactInfo {
  path: string;
  title?: string;
  phase?: string;
  ticket?: string;
}

export async function readArtifacts(paths: string[], cwd: string): Promise<ArtifactInfo[]> {
  return Promise.all(
    paths.map(async (p) => {
      try {
        const content = await readFile(join(cwd, p), "utf8");
        const fm = parseFrontmatter(content);
        return {
          path: p,
          title: fm?.title,
          phase: fm?.phase,
          ticket: fm?.ticket,
        };
      } catch {
        return { path: p };
      }
    }),
  );
}

// ── Spec / verify file discovery ────────────────────────────────────────────

export interface SpecFiles {
  spec?: { path: string; content: string };
  verify?: { path: string; content: string };
}

export async function findSpecFiles(
  cwd: string,
  ticket: string | null,
  branch: string,
): Promise<SpecFiles> {
  const slug = (ticket ?? branch.split("/").pop() ?? "").toLowerCase();
  if (!slug) return {};

  const result: SpecFiles = {};

  async function scanDevDir(devDir: string, prefix: string): Promise<void> {
    const dirs = await readdir(join(cwd, devDir));
    for (const dir of dirs) {
      const lower = dir.toLowerCase();
      if (!lower.includes(slug)) continue;
      try {
        const specPath = `${prefix}/${dir}/spec.json`;
        const content = await readFile(join(cwd, specPath), "utf8");
        if (!result.spec) result.spec = { path: specPath, content };
      } catch {
        /* no spec */
      }
      try {
        const verifyPath = `${prefix}/${dir}/verify.json`;
        const content = await readFile(join(cwd, verifyPath), "utf8");
        if (!result.verify) result.verify = { path: verifyPath, content };
      } catch {
        /* no verify */
      }
    }
  }

  try {
    await scanDevDir("docs/dev", "docs/dev");
  } catch {
    /* no docs/dev dir */
  }

  try {
    const appDirs = await readdir(join(cwd, "apps"));
    for (const app of appDirs) {
      try {
        await scanDevDir(`apps/${app}/docs/dev`, `apps/${app}/docs/dev`);
      } catch {
        /* no app-level docs/dev dir */
      }
    }
  } catch {
    /* no apps dir */
  }

  return result;
}

// ── Temp file message passing (avoids shell escaping issues) ─────────────────

/** Write text to a temp file, run fn, then clean up. Returns fn result. */
export async function withTempFile<T>(
  content: string,
  fn: (path: string) => Promise<T>,
): Promise<T> {
  const path = join(tmpdir(), `pi-git-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  try {
    await writeFile(path, content, "utf8");
    return await fn(path);
  } finally {
    await unlink(path).catch(() => {});
  }
}

// ── Commit message format validation ──────────────────────────────────

export interface MessageWarning {
  field: string;
  message: string;
}

/** Validate a commit message against format rules. Returns warnings (empty = valid). */
export function validateCommitMessage(message: string): MessageWarning[] {
  const warnings: MessageWarning[] = [];
  const lines = message.split("\n");
  const title = lines[0] ?? "";

  if (!title.trim()) {
    warnings.push({ field: "title", message: "Title line is empty" });
    return warnings;
  }

  if (title.length > 72) {
    warnings.push({
      field: "title",
      message: `Title is ${title.length} chars (max 72)`,
    });
  }

  const prefix = title.match(/^\[([^\]]+)\]/)?.[1]?.toUpperCase();
  const hasTicket = TICKET_RE.test(title);
  const hasTypePrefix =
    prefix !== undefined && (COMMIT_TYPE_PREFIXES as readonly string[]).includes(prefix);

  if (!hasTicket && !hasTypePrefix) {
    warnings.push({
      field: "title",
      message: "No ticket ID or type prefix found (expected [PROJ-123] or [FEATURE])",
    });
  }

  if (lines.length > 1 && lines[1]?.trim() !== "") {
    warnings.push({
      field: "format",
      message: "Missing blank line after title",
    });
  }

  return warnings;
}
