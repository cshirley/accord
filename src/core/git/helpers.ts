/**
 * Minimal git helpers for harness commit steps (no Pi tool dependency).
 */

import { execFile as execFileCb } from "node:child_process";
import { mkdtemp, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

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

export async function gitRoot(cwd: string, signal?: AbortSignal): Promise<string> {
  const { stdout } = await execFile("git", ["rev-parse", "--show-toplevel"], { cwd, signal });
  return stdout.trim();
}

export async function git(args: string[], cwd: string, signal?: AbortSignal): Promise<string> {
  const { stdout } = await execFile("git", args, {
    cwd,
    signal,
    maxBuffer: 10 * 1024 * 1024,
  });
  return stdout;
}

/** Paths from `git status --porcelain` (repo-relative). */
export function extractStatusPaths(statusRaw: string): string[] {
  const paths: string[] = [];
  for (const line of statusRaw.split("\n")) {
    if (!line.trim()) continue;
    const rest = line.slice(3);
    if (rest.includes(" -> ")) {
      const [, to] = rest.split(" -> ");
      if (to) paths.push(to.trim());
    } else {
      paths.push(rest.trim());
    }
  }
  return paths;
}

export async function commitWithMessage(
  cwd: string,
  files: string[],
  message: string,
  signal?: AbortSignal,
): Promise<{ hash: string }> {
  const root = await gitRoot(cwd, signal);
  for (const file of files) {
    await git(["add", "--", file], root, signal);
  }
  const staged = await git(["diff", "--staged", "--stat"], root, signal);
  if (!staged.trim()) {
    throw new Error("Nothing staged. Files may be unchanged.");
  }

  const dir = await mkdtemp(join(tmpdir(), "accord-commit-"));
  const msgFile = join(dir, "message.txt");
  try {
    await writeFile(msgFile, message, "utf8");
    await git(["commit", "-F", msgFile], root, signal);
  } finally {
    await unlink(msgFile).catch(() => {});
  }

  const hash = (await git(["rev-parse", "--short", "HEAD"], root, signal)).trim();
  return { hash };
}
