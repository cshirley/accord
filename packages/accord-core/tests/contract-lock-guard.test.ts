import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { contractLockToolCallBlock } from "../src/contract/lock-guard.js";

const ID = "GUARD-1";
const BASE = `docs/dev/${ID}`;
const NONCE = "abc123def456";
let cwd: string;

function put(rel: string, content: string): void {
  mkdirSync(dirname(join(cwd, rel)), { recursive: true });
  writeFileSync(join(cwd, rel), content);
}
const lock = () => put(`${BASE}/contract.lock.json`, "{}");
const openAmend = (marker = NONCE) => {
  put(`.tasks/${ID}-amend.json`, JSON.stringify({ nonce: NONCE }));
  put(`${BASE}/state/contract-amend.open`, marker);
};
const guard = (tool: string, path: string | undefined, root = cwd) =>
  contractLockToolCallBlock(tool, path === undefined ? {} : { path }, root);

beforeEach(() => {
  cwd = realpathSync(mkdtempSync(join(tmpdir(), "lock-guard-")));
});
afterEach(() => rmSync(cwd, { recursive: true, force: true }));

const LOCKED = ["brief.md", "spec.json", "plan.json"];
const ORCH_ONLY = ["contract.lock.json", "state/contract-amend.open"];

describe("ASDLC-1/AC-9 lock guard blocks without open amend", () => {
  const all = [...LOCKED, ...ORCH_ONLY];
  for (const tool of ["write", "edit"]) {
    for (const file of all) {
      it(`${tool} ${file} blocked with contract-amend reason`, () => {
        lock();
        const reason = guard(tool, `${BASE}/${file}`);
        expect(typeof reason).toBe("string");
        expect(reason).toMatch(/contract-amend/);
        // ASDLC-1/AC-9: reason names the procedure apart from the path, the work item and the file.
        const relative = `${BASE}/${file}`;
        expect((reason as string).replace(relative, "")).toMatch(/contract-amend/);
        expect(reason).toContain(ID);
        expect(reason).toContain(relative);
      });
    }
  }

  it("blocks absolute path and path with leading prefix", () => {
    lock();
    expect(guard("write", join(cwd, BASE, "spec.json"))).toMatch(/contract-amend/);
    expect(guard("edit", `/some/where/${BASE}/plan.json`)).toMatch(/contract-amend/);
  });

  it("blocks when marker exists but no session (invalid nonce)", () => {
    lock();
    put(`${BASE}/state/contract-amend.open`, NONCE);
    expect(guard("write", `${BASE}/spec.json`)).toMatch(/contract-amend/);
  });

  it("blocks when marker nonce differs from session nonce", () => {
    lock();
    openAmend("ffffffffffff");
    for (const file of LOCKED) {
      expect(guard("edit", `${BASE}/${file}`)).toMatch(/contract-amend/);
    }
  });

  it("blocks when marker is empty", () => {
    lock();
    openAmend("");
    expect(guard("write", `${BASE}/brief.md`)).toMatch(/contract-amend/);
  });
});

describe("ASDLC-1/AC-9 lock guard path shapes and lock states", () => {
  it.each([
    ["@docs/dev/GUARD-1/spec.json"],
    ["./docs/dev/GUARD-1/plan.json"],
    ["docs/dev/GUARD-1/./brief.md"],
    ["docs/dev/GUARD-1/state/../spec.json"],
    ["docs//dev/GUARD-1/spec.json"],
  ])("non-canonical path %s is blocked", (path) => {
    lock();
    expect(guard("write", path)).toMatch(/contract-amend/);
    expect(guard("edit", path)).toMatch(/contract-amend/);
  });

  it("../ path from a subdirectory cwd is blocked", () => {
    execFileSync("git", ["init", "-q"], { cwd });
    lock();
    const sub = join(cwd, "packages/app");
    mkdirSync(sub, { recursive: true });
    expect(guard("write", "../../docs/dev/GUARD-1/spec.json", sub)).toMatch(/contract-amend/);
  });

  it("../ path from a subdirectory cwd with no lock anywhere passes", () => {
    execFileSync("git", ["init", "-q"], { cwd });
    const sub = join(cwd, "packages/app");
    mkdirSync(sub, { recursive: true });
    expect(guard("write", "../../docs/dev/GUARD-1/spec.json", sub)).toBeNull();
  });

  it.each([["MY-TEAM-12"], ["MY_TEAM_12"]])("multi-segment id %s is blocked", (id) => {
    put(`docs/dev/${id}/contract.lock.json`, "{}");
    for (const file of ["spec.json", "plan.json", "brief.md"]) {
      expect(guard("write", `docs/dev/${id}/${file}`)).toMatch(/contract-amend/);
    }
  });

  it("unparseable lock file still blocks", () => {
    put(`${BASE}/contract.lock.json`, "{not json");
    expect(guard("write", `${BASE}/spec.json`)).toMatch(/contract-amend/);
  });

  it("./ non-JSON sibling of a locked name passes", () => {
    lock();
    expect(guard("write", `${BASE}/./spec.md`)).toBeNull();
  });

  it.each([
    ["empty nonce and empty marker", JSON.stringify({ nonce: "" }), ""],
    ["numeric nonce coerced to string marker", JSON.stringify({ nonce: 123 }), "123"],
    ["unparseable session", "{", "x"],
  ])("invalid amend session (%s) does not unlock", (_name, session, marker) => {
    lock();
    put(`.tasks/${ID}-amend.json`, session);
    put(`${BASE}/state/contract-amend.open`, marker);
    expect(guard("write", `${BASE}/spec.json`)).toMatch(/contract-amend/);
  });
});

describe("ASDLC-1/AC-9 lock guard with an open amend", () => {
  it("passes brief.md, spec.json, plan.json", () => {
    lock();
    openAmend();
    for (const tool of ["write", "edit"]) {
      for (const file of LOCKED) expect(guard(tool, `${BASE}/${file}`)).toBeNull();
    }
  });

  it("still blocks contract.lock.json and the marker (orchestrator-only)", () => {
    lock();
    openAmend();
    for (const tool of ["write", "edit"]) {
      for (const file of ORCH_ONLY) {
        expect(guard(tool, `${BASE}/${file}`)).toMatch(/contract-amend/);
      }
    }
  });

  it("an open amend for another work item does not unlock this one", () => {
    lock();
    put(`.tasks/OTHER-2-amend.json`, JSON.stringify({ nonce: NONCE }));
    put(`docs/dev/OTHER-2/state/contract-amend.open`, NONCE);
    expect(guard("write", `${BASE}/spec.json`)).toMatch(/contract-amend/);
  });
});

describe("ASDLC-1/AC-9 lock guard pass-through", () => {
  it("other files under the work item are untouched", () => {
    lock();
    for (const file of [
      "spec.md",
      "workflow-cost.json",
      "state/work-item.json",
      "evidence/task-1.json",
      "brief.md.bak",
      "notes/brief.md",
    ]) {
      expect(guard("write", `${BASE}/${file}`)).toBeNull();
    }
    expect(guard("edit", "packages/foo/src/spec.json")).toBeNull();
    expect(guard("write", ".tasks/GUARD-1-task-1.json")).toBeNull();
  });

  it("another work item without a lock is untouched", () => {
    lock();
    expect(guard("write", "docs/dev/OTHER-2/spec.json")).toBeNull();
  });

  it("other tools are untouched", () => {
    lock();
    for (const tool of ["read", "bash", "grep", "subagent", "Write", ""]) {
      expect(guard(tool, `${BASE}/spec.json`)).toBeNull();
    }
  });

  it("missing path or non-object input is untouched", () => {
    lock();
    expect(guard("write", undefined)).toBeNull();
    expect(guard("write", "")).toBeNull();
    expect(contractLockToolCallBlock("write", null, cwd)).toBeNull();
    expect(contractLockToolCallBlock("write", undefined, cwd)).toBeNull();
    expect(contractLockToolCallBlock("write", { path: 5 }, cwd)).toBeNull();
  });
});

describe("ASDLC-1/AC-26 no lock file means every write passes", () => {
  it("all locked paths pass without contract.lock.json", () => {
    for (const tool of ["write", "edit"]) {
      for (const file of [...LOCKED, ...ORCH_ONLY]) {
        expect(guard(tool, `${BASE}/${file}`)).toBeNull();
      }
    }
  });

  it("an open amend without a lock file also passes everything", () => {
    openAmend();
    expect(guard("write", `${BASE}/contract.lock.json`)).toBeNull();
    expect(guard("write", `${BASE}/state/contract-amend.open`)).toBeNull();
  });
});
