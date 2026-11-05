import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import type { AccordTrailer } from "../src/commit/commit-grammar.js";
import { guardStagedPaths, guardTrailer } from "../src/commit/commit-guard.js";
import { getLogLevel, setLogLevel } from "../src/logging.js";

const ID = "ASDLC-1";
const PATTERN = "**/*.test.ts";
const REVIEW = `docs/dev/${ID}/reviews/task-6/findings.json`;
const STATE = `docs/dev/${ID}/state/task-6/task.json`;
const EVIDENCE = `docs/dev/${ID}/evidence/task-6.md`;
const SRC = "packages/accord-core/src/foo.ts";
const TEST = "packages/accord-core/tests/foo.test.ts";
const OTHER_REVIEW = "docs/dev/OTHER-9/reviews/task-6/findings.json";

let errSpy: ReturnType<typeof spyOn>;
let priorLevel: ReturnType<typeof getLogLevel>;

function logged(): string[] {
  return errSpy.mock.calls.map((call: unknown[]) => String(call[0]));
}

beforeEach(() => {
  priorLevel = getLogLevel();
  setLogLevel("debug");
  errSpy = spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errSpy.mockRestore();
  setLogLevel(priorLevel);
});

describe("ASDLC-1/AC-3 guardStagedPaths — review commits keep only reviews/** and state/**", () => {
  for (const type of ["review-test", "review-code", "review-security"]) {
    it(`${type} keeps reviews and state paths, drops everything else`, () => {
      const result = guardStagedPaths(
        type,
        ID,
        [REVIEW, STATE, SRC, TEST, EVIDENCE, OTHER_REVIEW, "README.md"],
        PATTERN,
      );
      expect(result.kept).toEqual([REVIEW, STATE]);
      expect(result.rejected.sort()).toEqual(
        [SRC, TEST, EVIDENCE, OTHER_REVIEW, "README.md"].sort(),
      );
      expect(result.rule).toBe("reviews-only");
      const lines = logged().filter((line) => line.includes("stack.guard.rejected"));
      expect(lines).toHaveLength(result.rejected.length);
      expect(lines).toHaveLength(5);
      for (const line of lines) {
        expect(line).toContain("[accord:stack:warn]");
        expect(line).toContain(`ref=${type}`);
        expect(line).toContain("rule=reviews-only");
        expect(line).toMatch(/path=\S/);
        expect(line).not.toMatch(/rule=(undefined)?(\s|$)/);
      }
      for (const rejectedPath of result.rejected) {
        expect(lines.some((line) => line.includes(`path=${rejectedPath}`))).toBe(true);
      }
    });

    it(`${type} rejects traversal and lookalike prefixes`, () => {
      const sneaky = [
        `docs/dev/${ID}/reviews/../../../../src/x.ts`,
        `docs/dev/${ID}/reviewsX/a.json`,
        `docs/dev/${ID}-2/reviews/a.json`,
        `xdocs/dev/${ID}/reviews/a.json`,
      ];
      const result = guardStagedPaths(type, ID, sneaky, PATTERN);
      expect(result.kept).toEqual([]);
      expect(result.rejected.sort()).toEqual([...sneaky].sort());
    });

    it(`${type} with only in-scope paths rejects nothing`, () => {
      const result = guardStagedPaths(type, ID, [REVIEW, STATE], PATTERN);
      expect(result.kept).toEqual([REVIEW, STATE]);
      expect(result.rejected).toEqual([]);
      expect(result.respawn).toBeUndefined();
    });
  }
});

describe("ASDLC-1/AC-3 guardStagedPaths — code loop", () => {
  it("phase-code with a test path returns code-touches-test and respawns phase-test", () => {
    const result = guardStagedPaths("phase-code", ID, [SRC, TEST], PATTERN);
    expect(result.rejected).toEqual([TEST]);
    expect(result.rule).toBe("code-touches-test");
    expect(result.respawn).toBe("phase-test");
    expect(result.kept).toEqual([SRC]);
  });

  it("phase-code with only source paths is untouched", () => {
    const result = guardStagedPaths("phase-code", ID, [SRC, "README.md"], PATTERN);
    expect(result.kept).toEqual([SRC, "README.md"]);
    expect(result.rejected).toEqual([]);
    expect(result.rule).toBeUndefined();
    expect(result.respawn).toBeUndefined();
  });

  it("phase-code honours the configured pattern, not a hard-coded one", () => {
    const spec = "packages/x/src/a.spec.ts";
    const other = "packages/x/src/b.test.ts";
    const custom = guardStagedPaths("phase-code", ID, [spec, other], "**/*.spec.ts");
    expect(custom.rejected).toEqual([spec]);
    expect(custom.kept).toEqual([other]);
    expect(custom.rule).toBe("code-touches-test");
    expect(custom.respawn).toBe("phase-test");
  });

  // ASDLC-1/AC-3 (F-008): union with test-directory detection (isTestFilePath), so helpers
  // and fixtures under tests/ are test edits too.
  it("phase-code staging a helper under tests/ is rejected as a test edit", () => {
    const helper = "packages/accord-core/tests/helpers/setup.ts";
    const result = guardStagedPaths("phase-code", ID, [SRC, helper], PATTERN);
    expect(result.kept).toEqual([SRC]);
    expect(result.rejected).toEqual([helper]);
    expect(result.rule).toBe("code-touches-test");
    expect(result.respawn).toBe("phase-test");
  });

  // ASDLC-1/AC-3 (F-001): real Dev Harness patterns are slash-less basename globs.
  const patternRows: Array<[string, string, boolean]> = [
    ["*.test.{ts,tsx,js,jsx}", "packages/x/src/a.test.tsx", true],
    ["*.test.{ts,tsx,js,jsx}", "packages/x/src/a.ts", false],
    ["*_test.go", "pkg/api/handler_test.go", true],
    ["*_test.go", "pkg/api/handler.go", false],
    ["test_*.py", "tests/unit/test_api.py", true],
    ["test_*.py", "src/contest_api.py", false],
    ["**/*.test.ts", "root.test.ts", true],
    ["", "src/a.test.ts", true],
    ["", "src/a.ts", false],
  ];
  it.each(patternRows)("pattern %j path %j rejected=%p", (pattern, path, isRejected) => {
    const result = guardStagedPaths("phase-code", ID, [path], pattern);
    if (isRejected) {
      expect(result.rejected).toEqual([path]);
      expect(result.kept).toEqual([]);
      expect(result.rule).toBe("code-touches-test");
      expect(result.respawn).toBe("phase-test");
    } else {
      expect(result.rejected).toEqual([]);
      expect(result.kept).toEqual([path]);
      expect(result.rule).toBeUndefined();
      expect(result.respawn).toBeUndefined();
    }
  });

  it("phase-test may stage test files and production stubs", () => {
    const result = guardStagedPaths("phase-test", ID, [TEST, SRC], PATTERN);
    expect(result.kept).toEqual([TEST, SRC]);
    expect(result.rejected).toEqual([]);
    expect(result.respawn).toBeUndefined();
  });
});

describe("ASDLC-1/AC-3 guardStagedPaths — state and evidence commits", () => {
  it("state keeps only state paths", () => {
    const result = guardStagedPaths("state", ID, [STATE, SRC, REVIEW, EVIDENCE], PATTERN);
    expect(result.kept).toEqual([STATE]);
    expect(result.rejected.sort()).toEqual([SRC, REVIEW, EVIDENCE].sort());
    expect(result.rule).toBe("state-only");
  });

  // AC-5: the evidence commit deletes state/task-<N>/, so state paths stay in scope.
  it("evidence keeps evidence and state paths", () => {
    const result = guardStagedPaths("evidence", ID, [EVIDENCE, SRC, STATE, TEST, REVIEW], PATTERN);
    expect(result.kept).toEqual([EVIDENCE, STATE]);
    expect(result.rejected.sort()).toEqual([SRC, TEST, REVIEW].sort());
    expect(result.rule).toBe("evidence-only");
  });

  it("phase-verify-task keeps state paths and rejects source and test paths", () => {
    const result = guardStagedPaths("phase-verify-task", ID, [STATE, SRC, TEST], PATTERN);
    expect(result.kept).toEqual([STATE]);
    expect(result.rejected.sort()).toEqual([SRC, TEST].sort());
  });

  it("state and evidence reject traversal and lookalike prefixes", () => {
    const stateBad = [`docs/dev/${ID}/state/../../../../src/x.ts`, `docs/dev/${ID}/stateX/a`];
    const state = guardStagedPaths("state", ID, stateBad, PATTERN);
    expect(state.kept).toEqual([]);
    expect(state.rejected.sort()).toEqual([...stateBad].sort());
    const evBad = [`docs/dev/${ID}/evidence/../../../../src/x.ts`, `docs/dev/${ID}/evidenceX/a`];
    const ev = guardStagedPaths("evidence", ID, evBad, PATTERN);
    expect(ev.kept).toEqual([]);
    expect(ev.rejected.sort()).toEqual([...evBad].sort());
  });

  it("an unknown or mistyped commit type throws instead of allowing everything", () => {
    expect(() => guardStagedPaths("review_code", ID, [REVIEW], PATTERN)).toThrow(
      /unknown commit type/,
    );
    expect(() => guardStagedPaths("phase-plan", ID, [SRC], PATTERN)).toThrow(/unknown commit type/);
  });
});

describe("ASDLC-1/AC-3 guardTrailer — trailer-counts", () => {
  const trailer: AccordTrailer = {
    v: 1,
    id: ID,
    task: 6,
    seq: 3,
    ref: "review-C1",
    agent: "review-code",
    loop: "C",
    round: 1,
    outcome: "findings",
    crit: 1,
    warn: 1,
    sugg: 0,
  };

  it("matching counts are accepted", () => {
    const result = guardTrailer(ID, trailer, { findingsCount: 2 });
    expect(result.ok).toBe(true);
    expect(result.rule).toBeUndefined();
    expect(logged().some((line) => line.includes("stack.guard.rejected"))).toBe(false);
  });

  it("findings count mismatch rejects with rule trailer-counts", () => {
    const result = guardTrailer(ID, trailer, { findingsCount: 3 });
    expect(result.ok).toBe(false);
    expect(result.rule).toBe("trailer-counts");
    expect(result.errors).toContain("crit+warn+sugg=2 does not equal staged findings 3");
  });

  it("non-count failure (v=2) is rule trailer-invalid, not trailer-counts", () => {
    const result = guardTrailer(ID, { ...trailer, v: 2 } as unknown as AccordTrailer, {
      findingsCount: 2,
    });
    expect(result.ok).toBe(false);
    expect(result.rule).toBe("trailer-invalid");
    expect(result.errors).toContain("unsupported v=2");
  });

  it("trailer missing ref is rejected as trailer-invalid without logging ref=undefined", () => {
    const { ref: _ref, ...noRef } = trailer;
    const result = guardTrailer(ID, noRef as unknown as AccordTrailer, { findingsCount: 2 });
    expect(result.ok).toBe(false);
    expect(result.rule).toBe("trailer-invalid");
    expect(result.errors).toContain("missing required key ref");
    for (const line of logged().filter((entry) => entry.includes("stack.guard.rejected"))) {
      expect(line).not.toContain("ref=undefined");
    }
  });

  it("test count mismatch rejects with rule trailer-counts", () => {
    const result = guardTrailer(
      ID,
      { ...trailer, t_pass: 4, t_fail: 0 },
      {
        testCounts: { pass: 5, fail: 0 },
      },
    );
    expect(result.ok).toBe(false);
    expect(result.rule).toBe("trailer-counts");
  });

  it("ASDLC-1/AC-29 trailer rejection emits stack.guard.rejected at warn", () => {
    guardTrailer(ID, trailer, { findingsCount: 3 });
    const lines = logged().filter((line) => line.includes("stack.guard.rejected"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[accord:stack:warn]");
    expect(lines[0]).toContain(`work_item_id=${ID}`);
    expect(lines[0]).toContain("ref=review-C1");
    expect(lines[0]).toContain("rule=trailer-counts");
    expect(lines[0]).toContain("path=");
  });
});

describe("ASDLC-1/AC-29 guard rejection telemetry", () => {
  it("each rejected path emits one stack.guard.rejected at warn with work_item_id, ref, rule, path", () => {
    guardStagedPaths("phase-code", ID, [SRC, TEST, "tests/b.test.ts"], PATTERN);
    const lines = logged().filter((line) => line.includes("stack.guard.rejected"));
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(line).toContain("[accord:stack:warn]");
      expect(line).toContain(`work_item_id=${ID}`);
      expect(line).toContain("ref=phase-code");
      expect(line).toContain("rule=code-touches-test");
    }
    expect(lines[0]).toContain(`path=${TEST}`);
    expect(lines[1]).toContain("path=tests/b.test.ts");
  });

  it("out-of-scope review path emits a rejection naming that path", () => {
    guardStagedPaths("review-code", ID, [REVIEW, SRC], PATTERN);
    const lines = logged().filter((line) => line.includes("stack.guard.rejected"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[accord:stack:warn]");
    expect(lines[0]).toContain(`path=${SRC}`);
    expect(lines[0]).toContain("ref=review-code");
    expect(lines[0]).toContain("rule=reviews-only");
    expect(lines[0]).toContain(`work_item_id=${ID}`);
  });

  it("state and evidence rejections emit one warn line per path with their own rule", () => {
    const state = guardStagedPaths("state", ID, [STATE, SRC, REVIEW], PATTERN);
    const stateLines = logged().filter((line) => line.includes("stack.guard.rejected"));
    expect(stateLines).toHaveLength(state.rejected.length);
    expect(stateLines).toHaveLength(2);
    for (const line of stateLines) {
      expect(line).toContain("[accord:stack:warn]");
      expect(line).toContain("ref=state");
      expect(line).toContain("rule=state-only");
      expect(line).toContain(`work_item_id=${ID}`);
    }
    errSpy.mockClear();
    const ev = guardStagedPaths("evidence", ID, [EVIDENCE, SRC, TEST], PATTERN);
    const evLines = logged().filter((line) => line.includes("stack.guard.rejected"));
    expect(evLines).toHaveLength(ev.rejected.length);
    expect(evLines).toHaveLength(2);
    for (const line of evLines) {
      expect(line).toContain("ref=evidence");
      expect(line).toContain("rule=evidence-only");
    }
    expect(evLines.some((line) => line.includes(`path=${SRC}`))).toBe(true);
    expect(evLines.some((line) => line.includes(`path=${TEST}`))).toBe(true);
  });

  it("no rejection emits no stack.guard.rejected", () => {
    guardStagedPaths("review-code", ID, [REVIEW, STATE], PATTERN);
    guardStagedPaths("phase-code", ID, [SRC], PATTERN);
    expect(logged().some((line) => line.includes("stack.guard.rejected"))).toBe(false);
  });
});
