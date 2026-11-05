import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface TempGitRepo {
  readonly dir: string;
  commitFiles(files: Record<string, string>, message?: string): Promise<string>;
  cleanup(): Promise<void>;
}

const AUTHOR_ENV = {
  GIT_AUTHOR_NAME: "ACCORD Test",
  GIT_AUTHOR_EMAIL: "accord-test@example.invalid",
  GIT_COMMITTER_NAME: "ACCORD Test",
  GIT_COMMITTER_EMAIL: "accord-test@example.invalid",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};

function git(dir: string, args: string[]): string {
  const env: Record<string, string | undefined> = { ...process.env, ...AUTHOR_ENV };
  for (const key of Object.keys(env)) {
    if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|COMMON_DIR|NAMESPACE)$/.test(key)) {
      delete env[key];
    }
  }
  const res = spawnSync("git", args, { cwd: dir, encoding: "utf8", env });
  if (res.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${res.stderr}`);
  }
  return res.stdout.trim();
}

export async function createTempGitRepo(): Promise<TempGitRepo> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "accord-git-")));
  git(dir, ["init", "--quiet", "--initial-branch=main"]);
  git(dir, ["config", "commit.gpgsign", "false"]);
  let counter = 0;
  return {
    dir,
    async commitFiles(files, message) {
      for (const [relPath, content] of Object.entries(files)) {
        const abs = join(dir, relPath);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, content);
      }
      git(dir, ["add", "-A"]);
      counter += 1;
      git(dir, ["commit", "--quiet", "--allow-empty", "-m", message ?? `commit ${counter}`]);
      return git(dir, ["rev-parse", "HEAD"]);
    },
    async cleanup() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
