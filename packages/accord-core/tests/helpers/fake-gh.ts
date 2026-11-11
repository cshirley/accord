import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

export interface FakeGhResponse {
  /** argv prefix to match, e.g. ["pr", "list"]. */
  args: string[];
  json?: unknown;
  stdout?: string;
  exitCode?: number;
}

export interface FakeGhCall {
  argv: string[];
}

export interface FakeGh {
  readonly binDir: string;
  calls(): Promise<FakeGhCall[]>;
  restore(): Promise<void>;
}

export async function installFakeGh(responses: FakeGhResponse[]): Promise<FakeGh> {
  const binDir = realpathSync(mkdtempSync(join(tmpdir(), "accord-fake-gh-")));
  const callsFile = join(binDir, "calls.jsonl");
  const responsesFile = join(binDir, "responses.json");
  writeFileSync(callsFile, "");
  writeFileSync(responsesFile, JSON.stringify(responses));
  const script = `#!${process.execPath}
import { appendFileSync, readFileSync } from "node:fs";
const argv = process.argv.slice(2);
appendFileSync(${JSON.stringify(callsFile)}, JSON.stringify({ argv }) + "\\n");
const responses = JSON.parse(readFileSync(${JSON.stringify(responsesFile)}, "utf8"));
const match = responses.find((r) => r.args.every((a, i) => argv[i] === a));
if (!match) {
  process.stderr.write("fake gh: no canned response for: " + argv.join(" ") + "\\n");
  process.exit(127);
}
if (match.json !== undefined) process.stdout.write(JSON.stringify(match.json));
else if (match.stdout !== undefined) process.stdout.write(match.stdout);
process.exit(match.exitCode ?? 0);
`;
  const ghPath = join(binDir, "gh");
  writeFileSync(ghPath, script);
  chmodSync(ghPath, 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${binDir}${delimiter}${originalPath ?? ""}`;
  // Bun.spawn* without an explicit env uses the startup env snapshot, not the mutated
  // process.env; default it so callers omitting env still resolve the fake gh.
  // biome-ignore lint/suspicious/noExplicitAny: wrapping Bun's overloaded spawn API
  const bun = Bun as any;
  const originalSpawn = bun.spawn;
  const originalSpawnSync = bun.spawnSync;
  // biome-ignore lint/suspicious/noExplicitAny: wrapping Bun's overloaded spawn API
  const withEnv = (original: any) => (cmd: any, opts?: any) =>
    Array.isArray(cmd)
      ? original.call(Bun, cmd, { ...opts, env: opts?.env ?? process.env })
      : original.call(Bun, { ...cmd, env: cmd?.env ?? process.env });
  bun.spawn = withEnv(originalSpawn);
  bun.spawnSync = withEnv(originalSpawnSync);
  let restored = false;
  return {
    binDir,
    async calls() {
      return readFileSync(callsFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as FakeGhCall);
    },
    async restore() {
      if (restored) return;
      restored = true;
      bun.spawn = originalSpawn;
      bun.spawnSync = originalSpawnSync;
      if (originalPath === undefined) delete process.env.PATH;
      else process.env.PATH = originalPath;
      if (existsSync(binDir)) rmSync(binDir, { recursive: true, force: true });
    },
  };
}
