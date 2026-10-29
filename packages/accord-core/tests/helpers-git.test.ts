import { afterEach, describe, expect, it } from "bun:test";
import { execFile, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter } from "node:path";
import { promisify } from "node:util";
import { type FakeGh, installFakeGh } from "./helpers/fake-gh.js";
import { createTempGitRepo, type TempGitRepo } from "./helpers/temp-git-repo.js";

const scratch: string[] = [];
const mkScratch = (prefix: string) => {
  const d = mkdtempSync(`${tmpdir()}/${prefix}`);
  scratch.push(d);
  return d;
};
afterEach(() => {
  for (const d of scratch.splice(0)) rmSync(d, { recursive: true, force: true });
});

const git = (dir: string, ...args: string[]) =>
  spawnSync("git", args, { cwd: dir, encoding: "utf8" }).stdout.trim();

describe("ASDLC-1/T2 infra temp git repo helper", () => {
  const repos: TempGitRepo[] = [];
  afterEach(async () => {
    for (const r of repos.splice(0)) await r.cleanup();
  });
  const make = async () => {
    const r = await createTempGitRepo();
    repos.push(r);
    return r;
  };

  it("ASDLC-1/T2 infra creates a git repo on branch main", async () => {
    const r = await make();
    expect(existsSync(`${r.dir}/.git`)).toBe(true);
    expect(git(r.dir, "symbolic-ref", "--short", "HEAD")).toBe("main");
  });

  it("ASDLC-1/T2 infra commitFiles returns the new HEAD sha and writes files", async () => {
    const r = await make();
    const sha = await r.commitFiles({ "a.txt": "one", "dir/b.txt": "two" }, "first");
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(git(r.dir, "rev-parse", "HEAD")).toBe(sha);
    expect(readFileSync(`${r.dir}/dir/b.txt`, "utf8")).toBe("two");
    expect(git(r.dir, "log", "-1", "--format=%s")).toBe("first");
    expect(git(r.dir, "status", "--porcelain")).toBe("");
    const sha2 = await r.commitFiles({ "a.txt": "changed" });
    expect(sha2).not.toBe(sha);
    expect(git(r.dir, "rev-parse", "HEAD~1")).toBe(sha);
  });

  it("ASDLC-1/T2 infra uses a fixed author independent of host git config", async () => {
    const a = await make();
    const b = await make();
    await a.commitFiles({ x: "1" });
    await b.commitFiles({ x: "1" });
    const idA = git(a.dir, "log", "-1", "--format=%an <%ae>|%cn <%ce>");
    const idB = git(b.dir, "log", "-1", "--format=%an <%ae>|%cn <%ce>");
    expect(idA).toMatch(/^\S.* <\S+@\S+>\|\S.* <\S+@\S+>$/);
    expect(idA).toBe(idB);
  });

  it("ASDLC-1/T2 infra repos are isolated from each other", async () => {
    const a = await make();
    const b = await make();
    expect(a.dir).not.toBe(b.dir);
    await a.commitFiles({ "only-a.txt": "1" });
    expect(existsSync(`${b.dir}/only-a.txt`)).toBe(false);
  });

  it("ASDLC-1/T2 infra commitFiles round-trips a multi-line message with metacharacters and paths with spaces", async () => {
    const r = await make();
    const msg =
      "test(ASDLC-1/T2): red \"q\" $HOME `x` 'y'\n\nBody line\n\nAccord-Phase: red\nAccord-Task: 2";
    const sha = await r.commitFiles({ "dir with space/c d.txt": "x" }, msg);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(git(r.dir, "log", "-1", "--format=%B")).toBe(msg);
    expect(readFileSync(`${r.dir}/dir with space/c d.txt`, "utf8")).toBe("x");
    expect(git(r.dir, "status", "--porcelain")).toBe("");
  });

  it("ASDLC-1/T2 infra ignores hostile host git config and env", async () => {
    const cleanRepo = await make();
    await cleanRepo.commitFiles({ x: "1" });
    const fmt = "--format=%an <%ae>|%cn <%ce>";
    const idClean = git(cleanRepo.dir, "log", "-1", fmt);
    const tmp = realpathSync(mkScratch("hostile-"));
    const hooks = `${tmp}/hooks`;
    mkdirSync(hooks);
    writeFileSync(`${hooks}/pre-commit`, "#!/bin/sh\nexit 1\n");
    chmodSync(`${hooks}/pre-commit`, 0o755);
    const cfg = `${tmp}/gitconfig`;
    writeFileSync(
      cfg,
      `[user]\n name = Host Leak\n email = leak@host.invalid\n[init]\n defaultBranch = trunk\n[commit]\n gpgsign = true\n[core]\n hooksPath = ${hooks}\n`,
    );
    const keys = [
      "GIT_CONFIG_GLOBAL",
      "GIT_CONFIG_NOSYSTEM",
      "GIT_AUTHOR_NAME",
      "GIT_COMMITTER_EMAIL",
    ];
    const saved = keys.map((k) => [k, process.env[k]] as const);
    process.env.GIT_CONFIG_GLOBAL = cfg;
    process.env.GIT_CONFIG_NOSYSTEM = "1";
    process.env.GIT_AUTHOR_NAME = "Env Leak";
    process.env.GIT_COMMITTER_EMAIL = "envleak@host.invalid";
    try {
      const r = await make();
      await r.commitFiles({ x: "1" });
      expect(git(r.dir, "symbolic-ref", "--short", "HEAD")).toBe("main");
      const id = git(r.dir, "log", "-1", fmt);
      expect(id).not.toMatch(/leak/i);
      expect(id).toBe(idClean);
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });

  it("ASDLC-1/T2 infra ignores host GIT_DIR, GIT_WORK_TREE and GIT_INDEX_FILE", async () => {
    const host = await make();
    const hostSha = await host.commitFiles({ h: "1" });
    const keys = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE"];
    const saved = keys.map((k) => [k, process.env[k]] as const);
    process.env.GIT_DIR = `${host.dir}/.git`;
    process.env.GIT_WORK_TREE = host.dir;
    process.env.GIT_INDEX_FILE = `${host.dir}/.git/index`;
    let r: TempGitRepo;
    try {
      r = await make();
      await r.commitFiles({ z: "1" });
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
    expect(git(host.dir, "rev-parse", "HEAD")).toBe(hostSha);
    expect(git(host.dir, "status", "--porcelain")).toBe("");
    expect(git(r.dir, "rev-list", "--count", "HEAD")).toBe("1");
    expect(readFileSync(`${r.dir}/z`, "utf8")).toBe("1");
  });

  it("ASDLC-1/T2 infra creates repos inside the OS temp dir as their own toplevel", async () => {
    const r = await make();
    expect(realpathSync(r.dir).startsWith(realpathSync(tmpdir()))).toBe(true);
    expect(git(r.dir, "rev-parse", "--show-toplevel")).toBe(realpathSync(r.dir));
  });

  it("ASDLC-1/T2 infra cleanup removes the directory", async () => {
    const r = await createTempGitRepo();
    await r.commitFiles({ a: "1" });
    await r.cleanup();
    expect(existsSync(r.dir)).toBe(false);
  });
});

describe("ASDLC-1/T2 infra fake gh helper", () => {
  let fake: FakeGh | undefined;
  let originalPath: string | undefined;
  afterEach(async () => {
    await fake?.restore();
    fake = undefined;
    if (originalPath !== undefined) process.env.PATH = originalPath;
  });
  const run = (...args: string[]) => spawnSync("gh", args, { encoding: "utf8", env: process.env });

  it("ASDLC-1/T2 infra puts the fake first on PATH and replays canned JSON per argv pattern", async () => {
    originalPath = process.env.PATH;
    fake = await installFakeGh([
      { args: ["pr", "list"], json: [{ number: 7 }] },
      { args: ["pr", "view"], json: { number: 9, state: "OPEN" } },
    ]);
    expect(process.env.PATH?.split(delimiter)[0]).toBe(fake.binDir);
    const list = run("pr", "list", "--json", "number");
    expect(list.status).toBe(0);
    expect(JSON.parse(list.stdout)).toEqual([{ number: 7 }]);
    const view = run("pr", "view", "9");
    expect(JSON.parse(view.stdout)).toEqual({ number: 9, state: "OPEN" });
  });

  it("ASDLC-1/T2 infra fake is found by spawns that omit env", async () => {
    originalPath = process.env.PATH;
    fake = await installFakeGh([{ args: ["pr", "list"], json: [] }]);
    expect(spawnSync("gh", ["pr", "list"], { encoding: "utf8" }).stdout).toBe("[]");
    expect(new TextDecoder().decode(Bun.spawnSync(["gh", "pr", "list"]).stdout)).toBe("[]");
    const { stdout } = await promisify(execFile)("gh", ["pr", "list"]);
    expect(stdout).toBe("[]");
    const proc = Bun.spawn(["gh", "pr", "list"]);
    expect(await new Response(proc.stdout).text()).toBe("[]");
  });

  it("ASDLC-1/T2 infra records every call with exact argv in order", async () => {
    originalPath = process.env.PATH;
    fake = await installFakeGh([{ args: ["pr", "list"], json: [] }]);
    run("pr", "list", "--state", "open");
    run("pr", "create", "--title", "a b");
    expect(await fake.calls()).toEqual([
      { argv: ["pr", "list", "--state", "open"] },
      { argv: ["pr", "create", "--title", "a b"] },
    ]);
  });

  it("ASDLC-1/T2 infra unmatched argv fails non-zero (no network fallthrough) and is still recorded", async () => {
    originalPath = process.env.PATH;
    fake = await installFakeGh([{ args: ["pr", "list"], json: [] }]);
    const res = run("api", "repos/x/y");
    expect(res.status).not.toBe(0);
    expect(res.stdout).toBe("");
    expect(await fake.calls()).toEqual([{ argv: ["api", "repos/x/y"] }]);
  });

  it("ASDLC-1/T2 infra honours canned exitCode and stdout", async () => {
    originalPath = process.env.PATH;
    fake = await installFakeGh([{ args: ["pr", "merge"], stdout: "boom\n", exitCode: 3 }]);
    const res = run("pr", "merge", "1");
    expect(res.status).toBe(3);
    expect(res.stdout).toBe("boom\n");
  });

  it("ASDLC-1/T2 infra restore puts PATH back and removes the fake binary", async () => {
    originalPath = process.env.PATH;
    const before = process.env.PATH;
    const f = await installFakeGh([]);
    const dir = f.binDir;
    await f.restore();
    expect(process.env.PATH).toBe(before);
    expect(existsSync(`${dir}/gh`)).toBe(false);
  });

  it.each([
    [["pr", "listx"], null],
    [["pr"], null],
    [["api", "repos/o/r/pulls/12"], null],
    [["issue", "list", "pr"], null],
    [["pr", "list", "--state", "open"], []],
    [["api", "repos/o/r/pulls", "--paginate"], [{ number: 1 }]],
  ] as [string[], unknown][])(
    "ASDLC-1/T2 infra matches argv tokens as a prefix: %j",
    async (argv, expected) => {
      originalPath = process.env.PATH;
      fake = await installFakeGh([
        { args: ["pr", "list"], json: [] },
        { args: ["api", "repos/o/r/pulls"], json: [{ number: 1 }] },
      ]);
      const res = run(...argv);
      if (expected === null) {
        expect(res.status).not.toBe(0);
        expect(res.stdout).toBe("");
      } else {
        expect(res.status).toBe(0);
        expect(JSON.parse(res.stdout)).toEqual(expected);
      }
    },
  );

  it("ASDLC-1/T2 infra round-trips metachar args and replays from a non-test cwd", async () => {
    originalPath = process.env.PATH;
    const other = mkScratch("gh-cwd-");
    fake = await installFakeGh([{ args: ["pr", "view"], json: { n: 1 } }]);
    const body = "line1\nline2 \"q\" $HOME `x` 'y' \\n";
    spawnSync("gh", ["pr", "create", "--body", body], {
      cwd: other,
      env: process.env,
      encoding: "utf8",
    });
    const v = spawnSync("gh", ["pr", "view"], { cwd: other, env: process.env, encoding: "utf8" });
    expect(JSON.parse(v.stdout)).toEqual({ n: 1 });
    expect(await fake.calls()).toEqual([
      { argv: ["pr", "create", "--body", body] },
      { argv: ["pr", "view"] },
    ]);
  });

  it("ASDLC-1/T2 infra never executes a real gh later on PATH", async () => {
    originalPath = process.env.PATH;
    const realDir = mkScratch("real-gh-");
    const marker = `${realDir}/executed`;
    writeFileSync(`${realDir}/gh`, `#!/bin/sh\ntouch "${marker}"\necho REAL\n`);
    chmodSync(`${realDir}/gh`, 0o755);
    process.env.PATH = `${realDir}${delimiter}${originalPath ?? ""}`;
    fake = await installFakeGh([{ args: ["pr", "list"], json: [] }]);
    const unmatched = run("api", "repos/x/y");
    expect(unmatched.status).not.toBe(0);
    expect(unmatched.stdout).toBe("");
    expect(existsSync(marker)).toBe(false);
    const matched = run("pr", "list");
    expect(matched.status).toBe(0);
    expect(matched.stdout).toBe("[]");
    expect(existsSync(marker)).toBe(false);
  });

  it("ASDLC-1/T2 infra restore leaves no temp bin dir", async () => {
    originalPath = process.env.PATH;
    const f = await installFakeGh([]);
    const dir = f.binDir;
    await f.restore();
    expect(existsSync(dir)).toBe(false);
  });
});
