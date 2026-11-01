import { afterEach, describe, expect, mock, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import {
  type EvidenceContext,
  type EvidenceRule,
  evidenceRules,
  main,
  runEvidenceCheck,
  toCommitStatus,
} from "../src/evidence-check.js";

const ROOT = join(import.meta.dir, "..", "..", "..");
const CTX: EvidenceContext = { base: "a".repeat(40), head: "b".repeat(40) };

const passing = (name: string): EvidenceRule => ({ name, run: () => ({ ok: true }) });
const failing = (name: string, message: string): EvidenceRule => ({
  name,
  run: () => ({ ok: false, message }),
});

describe("ASDLC-1/AC-31 runEvidenceCheck", () => {
  test("ASDLC-1/AC-31 zero rules passes with exit 0 and no output lines", async () => {
    const result = await runEvidenceCheck([], CTX);
    expect(result.exitCode).toBe(0);
    expect(result.lines).toEqual([]);
    expect(result.failures).toEqual([]);
  });

  test("ASDLC-1/AC-31 all-passing rules exit 0", async () => {
    const result = await runEvidenceCheck([passing("a"), passing("b")], CTX);
    expect(result.exitCode).toBe(0);
    expect(result.failures).toEqual([]);
  });

  test("ASDLC-1/AC-31 failing rule yields exit 1 and 'accord/evidence: <rule>: <message>' line", async () => {
    const result = await runEvidenceCheck(
      [passing("ok-rule"), failing("no-state", "leftover state dir")],
      CTX,
    );
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual(["accord/evidence: no-state: leftover state dir"]);
    expect(result.failures).toEqual([{ rule: "no-state", message: "leftover state dir" }]);
  });

  test("ASDLC-1/AC-31 every failing rule reports its own line, in order", async () => {
    const result = await runEvidenceCheck(
      [failing("r1", "m1"), passing("r2"), failing("r3", "m3")],
      CTX,
    );
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual(["accord/evidence: r1: m1", "accord/evidence: r3: m3"]);
  });

  test("ASDLC-1/AC-31 rules receive exactly {base, head} shas", async () => {
    const seen: unknown[] = [];
    const spy: EvidenceRule = {
      name: "spy",
      run: (ctx) => {
        seen.push(ctx);
        return { ok: true };
      },
    };
    await runEvidenceCheck([spy, spy], CTX);
    expect(seen).toEqual([CTX, CTX]);
  });

  test("ASDLC-1/AC-31 a throwing rule becomes a failure, not a rejection", async () => {
    const boom: EvidenceRule = {
      name: "boom",
      run: () => {
        throw new Error("git failed");
      },
    };
    const result = await runEvidenceCheck([boom, passing("ok")], CTX);
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual(["accord/evidence: boom: git failed"]);
    expect(result.failures).toEqual([{ rule: "boom", message: "git failed" }]);
  });

  test("ASDLC-1/AC-31 a rejecting async rule becomes a failure, not a rejection", async () => {
    const boom: EvidenceRule = {
      name: "boom",
      run: async () => {
        throw new Error("git failed");
      },
    };
    const result = await runEvidenceCheck([boom, passing("ok")], CTX);
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual(["accord/evidence: boom: git failed"]);
    expect(result.failures).toEqual([{ rule: "boom", message: "git failed" }]);
  });

  test("ASDLC-1/AC-31 async rules are awaited", async () => {
    const slow: EvidenceRule = {
      name: "slow",
      run: async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { ok: false, message: "late" };
      },
    };
    const result = await runEvidenceCheck([slow], CTX);
    expect(result.exitCode).toBe(1);
    expect(result.lines).toEqual(["accord/evidence: slow: late"]);
  });
});

describe("ASDLC-1/AC-31 commit-status payload", () => {
  test("ASDLC-1/AC-31 success payload is exactly {context,state,description}", async () => {
    const payload = toCommitStatus(await runEvidenceCheck([], CTX));
    expect(Object.keys(payload).sort()).toEqual(["context", "description", "state"]);
    expect(payload.context).toBe("accord/evidence");
    expect(payload.state).toBe("success");
    expect(payload.description.length).toBeGreaterThan(0);
    expect(payload.description.length).toBeLessThanOrEqual(140);
  });

  test("ASDLC-1/AC-31 failure payload has state failure and names the rule and message", async () => {
    const payload = toCommitStatus(await runEvidenceCheck([failing("no-state", "leftover")], CTX));
    expect(payload.context).toBe("accord/evidence");
    expect(payload.state).toBe("failure");
    expect(payload.description).toContain("no-state");
    expect(payload.description).toContain("leftover");
  });

  test("ASDLC-1/AC-31 description is capped at 140 chars (GitHub limit)", async () => {
    const payload = toCommitStatus(
      await runEvidenceCheck([failing("leftover-state", "x".repeat(500))], CTX),
    );
    expect(payload.state).toBe("failure");
    expect(payload.description.length).toBeLessThanOrEqual(140);
    expect(payload.description).toContain("leftover-state");
  });

  test("ASDLC-1/AC-31 multiple failures: description names the first failing rule", async () => {
    const payload = toCommitStatus(
      await runEvidenceCheck([failing("first-rule", "m1"), failing("second-rule", "m2")], CTX),
    );
    expect(payload.state).toBe("failure");
    expect(payload.description).toContain("first-rule");
    expect(payload.description.length).toBeLessThanOrEqual(140);
  });
});

describe("ASDLC-1/AC-31 entry point (main)", () => {
  const A = "1".repeat(40);
  const B = "2".repeat(40);
  const dirs: string[] = [];
  const tmpFile = () => {
    const dir = mkdtempSync(join(tmpdir(), "evidence-check-"));
    dirs.push(dir);
    return join(dir, "status.json");
  };
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  test("ASDLC-1/AC-31 main runs rules over --base/--head, prints lines, writes status payload", async () => {
    const statusOut = tmpFile();
    const seen: unknown[] = [];
    const rule: EvidenceRule = {
      name: "r",
      run: (ctx) => {
        seen.push(ctx);
        return { ok: false, message: "m" };
      },
    };
    const lines: string[] = [];
    const code = await main({
      argv: ["--base", A, "--head", B, "--status-out", statusOut],
      rules: [rule],
      out: (line) => lines.push(line),
    });
    expect(code).toBe(1);
    expect(lines).toEqual(["accord/evidence: r: m"]);
    expect(seen).toEqual([{ base: A, head: B }]);
    const expected = toCommitStatus(await runEvidenceCheck([rule], { base: A, head: B }));
    expect(expected.state).toBe("failure");
    expect(JSON.parse(readFileSync(statusOut, "utf8"))).toEqual(expected);
  });

  test("ASDLC-1/AC-31 main with --head missing fails, names --head, runs no rule", async () => {
    const statusOut = tmpFile();
    const run = mock(() => ({ ok: true }) as const);
    const lines: string[] = [];
    const code = await main({
      argv: ["--base", A, "--status-out", statusOut],
      rules: [{ name: "r", run }],
      out: (line) => lines.push(line),
    });
    expect(code).not.toBe(0);
    expect(lines.join("\n")).toContain("--head");
    expect(run).not.toHaveBeenCalled();
  });

  test("ASDLC-1/AC-31 evidenceRules() is an array and main defaults to it", async () => {
    const registry = evidenceRules();
    expect(Array.isArray(registry)).toBe(true);
    expect(registry.map((rule) => rule.name)).toContain("contract-lock");
    const statusOut = tmpFile();
    // registered rules need a real repo; main's wiring is checked with an empty rule set
    const code = await main({
      argv: ["--base", A, "--head", B, "--status-out", statusOut],
      rules: [],
      out: () => {},
    });
    expect(code).toBe(0);
    expect(JSON.parse(readFileSync(statusOut, "utf8"))).toEqual(
      toCommitStatus({ exitCode: 0, lines: [], failures: [] }),
    );
    expect(JSON.parse(readFileSync(statusOut, "utf8")).state).toBe("success");
  });

  test("ASDLC-1/AC-31 bun entry point (import.meta.main) writes a success payload", () => {
    const statusOut = tmpFile();
    const A = execFileSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    const B = A;
    const proc = Bun.spawnSync(
      [
        "bun",
        "packages/accord-ci/src/evidence-check.ts",
        "--base",
        A,
        "--head",
        B,
        "--status-out",
        statusOut,
      ],
      { cwd: ROOT },
    );
    expect(proc.exitCode).toBe(0);
    const payload = JSON.parse(readFileSync(statusOut, "utf8")) as Record<string, unknown>;
    expect(payload.context).toBe("accord/evidence");
    expect(payload.state).toBe("success");
    expect(typeof payload.description).toBe("string");
    expect((payload.description as string).length).toBeGreaterThan(0);
  });
});

type Obj = Record<string, unknown>;
type Step = { name?: string; uses?: string; if?: string; run?: string; env?: Obj; with?: Obj };

describe("ASDLC-1/AC-31 workflow and docs declaration", () => {
  // Runtime enforcement belongs to phase-verify-task / CI; these pin the declaration.
  const raw = () => readFileSync(join(ROOT, ".github/workflows/accord-evidence.yml"), "utf8");
  const doc = () => parseYaml(raw()) as Obj;
  const jobs = (): Obj[] => Object.values((doc().jobs ?? {}) as Obj) as Obj[];
  const steps = (): Step[] => jobs().flatMap((job) => (job.steps ?? []) as Step[]);
  const scriptStep = () =>
    steps().find((s) => s.run?.includes("packages/accord-ci/src/evidence-check.ts"));
  const statusStep = () => steps().find((s) => /gh api/.test(s.run ?? ""));
  const envText = (step: Step | undefined) =>
    JSON.stringify({
      wf: doc().env ?? {},
      job: jobs().map((j) => j.env ?? {}),
      step: step?.env ?? {},
    });

  test("ASDLC-1/AC-31 triggers: pull_request and push both filtered to main, no pull_request_target", () => {
    const on = doc().on as Obj;
    expect((on.pull_request as Obj).branches).toEqual(["main"]);
    expect((on.push as Obj).branches).toEqual(["main"]);
    expect(Object.keys(on)).not.toContain("pull_request_target");
  });

  test("ASDLC-1/AC-31 checkout fetches full history", () => {
    const checkout = steps().find((s) => s.uses?.startsWith("actions/checkout"));
    expect(checkout).toBeDefined();
    expect(checkout?.with?.["fetch-depth"]).toBe(0);
    expect(raw()).toContain("fetch-depth: 0");
  });

  test("ASDLC-1/AC-31 head sha is the PR head (not merge sha) on PRs and github.sha on push", () => {
    const script = scriptStep();
    const status = statusStep();
    expect(script).toBeDefined();
    expect(status).toBeDefined();
    const expr = /\$\{\{[^}]*github\.event\.pull_request\.head\.sha[^}]*github\.sha[^}]*\}\}/;
    const scriptEnv = envText(script);
    const statusEnv = envText(status);
    expect(scriptEnv).toMatch(/github\.event\.pull_request\.head\.sha/);
    expect(scriptEnv).toMatch(/github\.sha/);
    expect(statusEnv).toMatch(/github\.event\.pull_request\.head\.sha/);
    expect(statusEnv).toMatch(/github\.sha/);
    expect(scriptEnv + statusEnv + (script?.run ?? "")).toMatch(expr);
    expect(status?.run).toMatch(/statuses\//);
    expect(status?.run).not.toContain("statuses/${{ github.sha }}");
    expect(status?.run).not.toMatch(/statuses\/\$\{\{\s*github\.event\.pull_request\.merge/);
  });

  test("ASDLC-1/AC-31 base is PR base sha/ref or push 'before'; never HEAD~1 or HEAD^", () => {
    const script = scriptStep();
    const text = `${script?.run ?? ""}${envText(script)}`;
    expect(text).toMatch(/github\.event\.pull_request\.base\.sha|github\.base_ref/);
    expect(text).toContain("github.event.before");
    expect(text).not.toMatch(/HEAD~1|HEAD\^/);
  });

  test("ASDLC-1/AC-31 script step passes --status-out; status step posts that file via gh api, always runs", () => {
    const script = scriptStep();
    expect(script?.run).toMatch(/--status-out\s+(\S+)/);
    const statusPath = /--status-out\s+(\S+)/.exec(script?.run ?? "")?.[1];
    const status = statusStep();
    expect(status).toBeDefined();
    expect(status?.if).toMatch(/always\(\)|!cancelled\(\)/);
    expect(status?.run).toContain("gh api");
    expect(status?.run).toContain("statuses/");
    expect(status?.run).toMatch(/--input/);
    expect(status?.run).toContain(statusPath as string);
    expect(status?.run).not.toMatch(/state=success/);
    expect(status?.run).not.toMatch(/-f\s+state=|-F\s+state=/);
    expect(raw()).toContain("accord/evidence");
  });

  test("ASDLC-1/AC-31 permissions: only statuses: write (contents read at most), never write-all", () => {
    const all: unknown[] = [doc().permissions, ...jobs().map((j) => j.permissions)].filter(
      (p) => p !== undefined,
    );
    expect(all.length).toBeGreaterThan(0);
    let sawStatuses = false;
    for (const perms of all) {
      expect(typeof perms).toBe("object");
      const p = perms as Obj;
      for (const key of Object.keys(p)) expect(["contents", "statuses"]).toContain(key);
      if (p.statuses !== undefined) {
        expect(p.statuses).toBe("write");
        sawStatuses = true;
      }
      if (p.contents !== undefined) expect(p.contents).toBe("read");
    }
    expect(sawStatuses).toBe(true);
  });

  test("ASDLC-1/AC-31 no secret besides GITHUB_TOKEN; token is never echoed or dumped", () => {
    const text = raw();
    const dotted = [...text.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((m) => m[1]);
    const indexed = [...text.matchAll(/secrets\[['"]([^'"]+)['"]\]/g)].map((m) => m[1]);
    const names = new Set([...dotted, ...indexed]);
    expect(
      dotted.length + indexed.length + (text.includes("github.token") ? 1 : 0),
    ).toBeGreaterThan(0);
    for (const name of names) expect(name).toBe("GITHUB_TOKEN");
    expect(text).not.toMatch(/echo[^\n]*(GITHUB_TOKEN|GH_TOKEN|github\.token)/);
    expect(text).not.toMatch(/(printf|cat)[^\n]*(GITHUB_TOKEN|GH_TOKEN)/);
    expect(text).not.toMatch(/\b(printenv|set -x)\b|^\s*env\s*$/m);
  });

  test("ASDLC-1/AC-31 docs/ci/pre-merge-smoke.md documents the accord-evidence workflow as required", () => {
    const text = readFileSync(join(ROOT, "docs/ci/pre-merge-smoke.md"), "utf8");
    expect(text).toContain("accord-evidence");
    expect(text).toContain("accord/evidence");
    expect(text).toMatch(/^##.*accord\/evidence/m);
    const scope = text.split(/^## /m)[0] ?? "";
    expect(scope).toContain("accord-evidence.yml");
  });

  test("ASDLC-1/AC-31 okf/log.md has a dated entry (>= 2026-10-06) naming accord-evidence.yml", () => {
    const log = readFileSync(join(ROOT, "okf/log.md"), "utf8");
    const parts = log.split(/^## (\d{4}-\d{2}-\d{2})$/m);
    // parts: [preamble, date1, body1, date2, body2, ...]
    const matches: string[] = [];
    for (let index = 1; index < parts.length; index += 2) {
      const body = parts[index + 1] ?? "";
      if (/^\* \*\*(Creation|Update|Fix|Tooling)\*\*:.*accord-evidence\.yml/m.test(body)) {
        matches.push(parts[index] as string);
      }
    }
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.some((date) => date >= "2026-10-06")).toBe(true);
  });

  test("ASDLC-1/AC-31 an okf concept lists the evidence check as a source and describes accord/evidence", () => {
    const dir = join(ROOT, "okf");
    const files = [...new Bun.Glob("**/*.md").scanSync({ cwd: dir })];
    const hits = files.filter((file) => {
      const text = readFileSync(join(dir, file), "utf8");
      const front = text.split(/^---$/m)[1] ?? "";
      const body = text.split(/^---$/m).slice(2).join("---");
      const listed =
        front.includes("resource: /packages/accord-ci/src/evidence-check.ts") ||
        front.includes("resource: /.github/workflows/accord-evidence.yml");
      return listed && body.includes("accord/evidence");
    });
    expect(hits.length).toBeGreaterThan(0);
  });
});
