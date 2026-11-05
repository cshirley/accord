import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateArtifact } from "../src/artifacts/validation.js";
import {
  amendMarkerPath,
  isAmendOpen,
  lockedPaths,
  verifyContractLock,
  writeContractLock,
} from "../src/contract/lock.js";

const ID = "ASDLC-1";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const paths = (id: string) => [
  `docs/dev/${id}/brief.md`,
  `docs/dev/${id}/spec.json`,
  `docs/dev/${id}/plan.json`,
];

let cwd: string;
let dir: string;
const BRIEF = "# Brief\nhello\n";
const SPEC = `${JSON.stringify({ id: "spec", acceptance_criteria: [{ id: "AC-1", text: "a" }] }, null, 2)}\n`;
const planObj = () => ({
  schema_version: "1.0",
  work_item_id: ID,
  reuse_candidates: [{ path: "x" }],
  tasks: [{ id: 1, title: "t1", covers_ac: ["AC-1"] }],
  guidance: [{ directive: "d", source: "engineer" }],
});

function sh(...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}
function writePlan(p: unknown) {
  writeFileSync(join(dir, "plan.json"), `${JSON.stringify(p, null, 2)}\n`);
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "contract-lock-"));
  sh("init", "-q");
  sh("config", "user.email", "t@example.com");
  sh("config", "user.name", "t");
  sh("config", "commit.gpgsign", "false");
  dir = join(cwd, "docs", "dev", ID);
  mkdirSync(join(dir, "state"), { recursive: true });
  writeFileSync(join(dir, "brief.md"), BRIEF);
  writeFileSync(join(dir, "spec.json"), SPEC);
  writePlan(planObj());
  writeFileSync(join(dir, "state", "work-item.json"), "{}\n");
  sh("add", "-A");
  sh("commit", "-q", "-m", "pr0 contract");
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

const lockPath = () => join(dir, "contract.lock.json");
const readLock = () => JSON.parse(readFileSync(lockPath(), "utf8"));
const deleteByValue = (node: unknown, value: string): void => {
  if (node === null || typeof node !== "object") return;
  const rec = node as Record<string, unknown>;
  for (const key of Object.keys(rec)) {
    if (rec[key] === value) Reflect.deleteProperty(rec, key);
    else deleteByValue(rec[key], value);
  }
};

describe("ASDLC-1/AC-9 contract lock writer", () => {
  it("lockedPaths is exactly brief.md, spec.json, plan.json under docs/dev/<ID> (no state/**)", () => {
    expect(lockedPaths(ID)).toEqual(paths(ID));
    expect(lockedPaths("FOO-2")).toEqual(paths("FOO-2"));
  });

  it("writes contract.lock.json pinning sha256 of each locked file and the preceding commit", async () => {
    const head = sh("rev-parse", "HEAD");
    await writeContractLock(ID, cwd);
    expect(existsSync(lockPath())).toBe(true);
    const parsed = readLock();
    expect(parsed).toEqual({
      schema_version: "1.0",
      work_item_id: ID,
      preceding_commit: head,
      files: {
        "docs/dev/ASDLC-1/brief.md": sha(BRIEF),
        "docs/dev/ASDLC-1/spec.json": sha(SPEC),
        "docs/dev/ASDLC-1/plan.json": expect.any(String),
      },
    });
    const raw = readFileSync(lockPath(), "utf8");
    expect(raw).not.toContain(sha(readFileSync(join(dir, "plan.json"), "utf8")));
    expect(raw).not.toContain(sha("{}\n"));
    expect(raw).not.toContain("work-item");
  });

  it("re-locking after an edit refreshes hashes and preceding_commit", async () => {
    await writeContractLock(ID, cwd);
    writeFileSync(join(dir, "brief.md"), `${BRIEF}more\n`);
    sh("commit", "-qam", "amend");
    const head2 = sh("rev-parse", "HEAD");
    await writeContractLock(ID, cwd);
    expect(readLock().files["docs/dev/ASDLC-1/brief.md"]).toBe(sha(`${BRIEF}more\n`));
    expect(readLock().preceding_commit).toBe(head2);
    expect(await verifyContractLock(ID, cwd)).toEqual({ unchanged: true, changed: [] });
  });

  it("plan hash is of canonical JSON with guidance[] removed", async () => {
    await writeContractLock(ID, cwd);
    const { guidance: _g, ...rest } = planObj();
    const canonicalInsertion = sha(JSON.stringify(rest));
    const canonicalSorted = sha(
      JSON.stringify({
        reuse_candidates: [{ path: "x" }],
        schema_version: "1.0",
        tasks: [{ covers_ac: ["AC-1"], id: 1, title: "t1" }],
        work_item_id: ID,
      }),
    );
    expect([canonicalInsertion, canonicalSorted]).toContain(
      readLock().files["docs/dev/ASDLC-1/plan.json"],
    );
  });

  it("rejects when a locked file is missing at lock time and writes no lock", async () => {
    rmSync(join(dir, "brief.md"));
    await expect(writeContractLock(ID, cwd)).rejects.toThrow(/brief\.md/);
    expect(existsSync(lockPath())).toBe(false);
  });

  it("contract.lock.json validates via SCHEMA_MAP", async () => {
    await writeContractLock(ID, cwd);
    const res = await validateArtifact(lockPath());
    expect(res.errors).toEqual([]);
    expect(res.valid).toBe(true);
  });

  it("empty lock fails schema validation", async () => {
    await writeContractLock(ID, cwd);
    writeFileSync(lockPath(), "{}\n");
    expect((await validateArtifact(lockPath())).valid).toBe(false);
  });

  const requiredKeys: [string, (lock: Record<string, any>) => void][] = [
    [
      "schema_version",
      (l) => {
        Reflect.deleteProperty(l, "schema_version");
      },
    ],
    [
      "work_item_id",
      (l) => {
        Reflect.deleteProperty(l, "work_item_id");
      },
    ],
    [
      "preceding_commit",
      (l) => {
        Reflect.deleteProperty(l, "preceding_commit");
      },
    ],
    [
      "files",
      (l) => {
        Reflect.deleteProperty(l, "files");
      },
    ],
    [
      "files.brief.md",
      (l) => {
        Reflect.deleteProperty(l.files, "docs/dev/ASDLC-1/brief.md");
      },
    ],
    [
      "files.spec.json",
      (l) => {
        Reflect.deleteProperty(l.files, "docs/dev/ASDLC-1/spec.json");
      },
    ],
    [
      "files.plan.json",
      (l) => {
        Reflect.deleteProperty(l.files, "docs/dev/ASDLC-1/plan.json");
      },
    ],
  ];
  it.each(requiredKeys)("schema rejects a lock missing %s", async (_name, mutate) => {
    await writeContractLock(ID, cwd);
    const lock = readLock();
    mutate(lock);
    writeFileSync(lockPath(), `${JSON.stringify(lock, null, 2)}\n`);
    expect((await validateArtifact(lockPath())).valid).toBe(false);
  });

  it("schema rejects a malformed sha256 value", async () => {
    await writeContractLock(ID, cwd);
    const raw = readFileSync(lockPath(), "utf8");
    writeFileSync(lockPath(), raw.replace(sha(BRIEF), "not-a-sha"));
    expect((await validateArtifact(lockPath())).valid).toBe(false);
  });

  it("schema rejects a malformed preceding_commit", async () => {
    const head = sh("rev-parse", "HEAD");
    await writeContractLock(ID, cwd);
    const raw = readFileSync(lockPath(), "utf8");
    writeFileSync(lockPath(), raw.replace(head, "zz"));
    expect((await validateArtifact(lockPath())).valid).toBe(false);
  });
});

describe("ASDLC-1/AC-9 contract lock verifier", () => {
  const [BRIEF_P, SPEC_P, PLAN_P] = paths(ID);

  it("reports unchanged with no changed files right after writing", async () => {
    await writeContractLock(ID, cwd);
    expect(await verifyContractLock(ID, cwd)).toEqual({ unchanged: true, changed: [] });
  });

  it("names brief.md when only brief.md is edited", async () => {
    await writeContractLock(ID, cwd);
    writeFileSync(join(dir, "brief.md"), `${BRIEF}more\n`);
    expect(await verifyContractLock(ID, cwd)).toEqual({ unchanged: false, changed: [BRIEF_P] });
  });

  it("names spec.json when only spec.json is edited", async () => {
    await writeContractLock(ID, cwd);
    writeFileSync(join(dir, "spec.json"), `${SPEC}\n`);
    expect(await verifyContractLock(ID, cwd)).toEqual({ unchanged: false, changed: [SPEC_P] });
  });

  it("names every changed file when several are edited", async () => {
    await writeContractLock(ID, cwd);
    writeFileSync(join(dir, "brief.md"), "x");
    const p = planObj();
    p.tasks[0].title = "changed";
    writePlan(p);
    const r = await verifyContractLock(ID, cwd);
    expect(r.unchanged).toBe(false);
    expect([...r.changed].sort()).toEqual([BRIEF_P, PLAN_P]);
  });

  it("edit that changes only plan.guidance reports unchanged", async () => {
    await writeContractLock(ID, cwd);
    const p = planObj();
    p.guidance.push({ directive: "as-built record", source: "engineer" });
    writePlan(p);
    expect(await verifyContractLock(ID, cwd)).toEqual({ unchanged: true, changed: [] });
  });

  it("removing guidance entirely still reports unchanged", async () => {
    await writeContractLock(ID, cwd);
    const { guidance: _g, ...rest } = planObj();
    writePlan(rest);
    expect(await verifyContractLock(ID, cwd)).toEqual({ unchanged: true, changed: [] });
  });

  it("reformatting plan.json (compact, reversed key order) reports unchanged", async () => {
    await writeContractLock(ID, cwd);
    const reversed = Object.fromEntries(Object.entries(planObj()).reverse());
    writeFileSync(join(dir, "plan.json"), JSON.stringify(reversed));
    expect(await verifyContractLock(ID, cwd)).toEqual({ unchanged: true, changed: [] });
  });

  it("edit to a plan task reports plan.json changed", async () => {
    await writeContractLock(ID, cwd);
    const p = planObj();
    p.tasks[0].title = "different";
    writePlan(p);
    expect(await verifyContractLock(ID, cwd)).toEqual({ unchanged: false, changed: [PLAN_P] });
  });

  it("edit to a plan AC mapping reports plan.json changed", async () => {
    await writeContractLock(ID, cwd);
    const p = planObj();
    p.tasks[0].covers_ac = ["AC-2"];
    writePlan(p);
    expect(await verifyContractLock(ID, cwd)).toEqual({ unchanged: false, changed: [PLAN_P] });
  });

  it.each([
    [
      "reuse_candidates",
      (p: any) => {
        p.reuse_candidates = [{ path: "y" }];
      },
    ],
    [
      "work_item_id",
      (p: any) => {
        p.work_item_id = "ASDLC-2";
      },
    ],
    [
      "schema_version",
      (p: any) => {
        p.schema_version = "2.0";
      },
    ],
  ])("edit to non-task plan key %s reports plan.json changed", async (_k, mutate) => {
    await writeContractLock(ID, cwd);
    const p = planObj();
    mutate(p);
    writePlan(p);
    expect(await verifyContractLock(ID, cwd)).toEqual({ unchanged: false, changed: [PLAN_P] });
  });

  it("state/** edits and state/work-item.json deletion are not locked", async () => {
    await writeContractLock(ID, cwd);
    writeFileSync(join(dir, "state", "STATE.md"), "new");
    rmSync(join(dir, "state", "work-item.json"));
    expect(await verifyContractLock(ID, cwd)).toEqual({ unchanged: true, changed: [] });
  });

  // The lock file, not git, is the baseline (durable record).
  const rows: [string, () => Promise<void> | void, string[]][] = [
    [
      "committed edit",
      () => {
        writeFileSync(join(dir, "brief.md"), `${BRIEF}more\n`);
        sh("commit", "-qam", "edit");
      },
      [BRIEF_P],
    ],
    [
      "tampered lock hash",
      () => {
        writeFileSync(
          lockPath(),
          readFileSync(lockPath(), "utf8").replace(sha(BRIEF), "0".repeat(64)),
        );
      },
      [BRIEF_P],
    ],
    [
      "lock entry removed",
      () => {
        const lock = readLock();
        deleteByValue(lock, sha(BRIEF));
        writeFileSync(lockPath(), `${JSON.stringify(lock, null, 2)}\n`);
      },
      [BRIEF_P],
    ],
    ["locked file deleted", () => rmSync(join(dir, "brief.md")), [BRIEF_P]],
    ["plan.json unparseable", () => writeFileSync(join(dir, "plan.json"), "{"), [PLAN_P]],
  ];
  it.each(rows)("%s is reported as changed", async (_name, setup, expected) => {
    await writeContractLock(ID, cwd);
    await setup();
    const r = await verifyContractLock(ID, cwd);
    expect(r.unchanged).toBe(false);
    if (_name === "lock entry removed") expect(r.changed).toContain(BRIEF_P);
    else expect(r.changed).toEqual(expected);
  });

  it("rejects when contract.lock.json is missing", async () => {
    await writeContractLock(ID, cwd);
    rmSync(lockPath());
    await expect(verifyContractLock(ID, cwd)).rejects.toThrow(/contract\.lock\.json/);
  });
});

describe("ASDLC-1/AC-9 amend marker", () => {
  const session = () => join(cwd, ".tasks", `${ID}-amend.json`);
  const writeSession = (nonce: string) => {
    mkdirSync(join(cwd, ".tasks"), { recursive: true });
    writeFileSync(session(), JSON.stringify({ nonce }));
  };
  const writeMarker = (content: string) => {
    mkdirSync(join(dir, "state"), { recursive: true });
    writeFileSync(join(dir, "state", "contract-amend.open"), content);
  };

  it("amendMarkerPath is docs/dev/<ID>/state/contract-amend.open", () => {
    expect(amendMarkerPath(ID, cwd)).toBe(join(dir, "state", "contract-amend.open"));
  });

  it("is open when marker nonce equals the session nonce", () => {
    writeSession("abc123def456");
    writeMarker("abc123def456");
    expect(isAmendOpen(ID, cwd)).toBe(true);
  });

  it("is not open with no marker and no session", () => {
    expect(isAmendOpen(ID, cwd)).toBe(false);
  });

  it("is not open with a session but no marker", () => {
    writeSession("abc123def456");
    expect(isAmendOpen(ID, cwd)).toBe(false);
  });

  it("is not open with a marker but no session file", () => {
    writeMarker("abc123def456");
    expect(isAmendOpen(ID, cwd)).toBe(false);
  });

  it("is not open when the marker nonce is wrong", () => {
    writeSession("abc123def456");
    writeMarker("ffffffffffff");
    expect(isAmendOpen(ID, cwd)).toBe(false);
  });

  it("is not open when the marker is empty, even if the session nonce is empty", () => {
    writeSession("");
    writeMarker("");
    expect(isAmendOpen(ID, cwd)).toBe(false);
  });

  it.each([
    ["marker is a prefix-extension of session", "abc123", "abc123def456"],
    ["session is a prefix-extension of marker", "abc123def456", "abc123"],
    ["marker has a trailing newline (exact match required)", "abc", "abc\n"],
  ])("is not open when %s", (_n, sessionNonce, marker) => {
    writeSession(sessionNonce);
    writeMarker(marker);
    expect(isAmendOpen(ID, cwd)).toBe(false);
  });

  it("is not open when session has no nonce and marker is 'undefined'", () => {
    mkdirSync(join(cwd, ".tasks"), { recursive: true });
    writeFileSync(session(), "{}");
    writeMarker("undefined");
    expect(isAmendOpen(ID, cwd)).toBe(false);
  });

  it("is not open (and does not throw) when the session file is unparseable", () => {
    mkdirSync(join(cwd, ".tasks"), { recursive: true });
    writeFileSync(session(), "{");
    writeMarker("x");
    expect(isAmendOpen(ID, cwd)).toBe(false);
  });

  it("is not open when the session nonce is a number equal to the marker text", () => {
    mkdirSync(join(cwd, ".tasks"), { recursive: true });
    writeFileSync(session(), JSON.stringify({ nonce: 123 }));
    writeMarker("123");
    expect(isAmendOpen(ID, cwd)).toBe(false);
  });
});

describe("ASDLC-1/AC-30 schema alignment for contract.lock.json", () => {
  it("schema file exists in schemas/", () => {
    expect(existsSync(join(import.meta.dir, "..", "schemas", "contract-lock-schema.json"))).toBe(
      true,
    );
  });
});
