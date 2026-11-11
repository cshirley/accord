import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type AccordTrailer,
  buildCommitMessage,
  buildSubject,
  parseAccordTrailer,
  parseSubject,
  validateTrailer,
} from "../src/commit/commit-grammar";
import { createTempGitRepo, type TempGitRepo } from "./helpers/temp-git-repo";

const FIXTURES = join(import.meta.dir, "fixtures", "commit-grammar");
const goldenMessages = readFileSync(join(FIXTURES, "messages.golden.txt"), "utf8")
  .replace(/\n$/, "")
  .split("\n=====\n");
const awkGolden = readFileSync(join(FIXTURES, "awk-extract.golden.txt"), "utf8");

// Documented subject regex (plan section 3.2e).
const SUBJECT_RE =
  /^\[([A-Z]+(-[A-Z]+)*-[0-9]+)\]\[task-([0-9]+)\] ([TCVS][0-9]+(\.[0-9]+)?)\/([a-z-]+): /;

interface Case {
  name: string;
  summary: string;
  body: string;
  trailer: AccordTrailer;
}

const CASES: Case[] = [
  {
    name: "T1/phase-test",
    summary: "4 failing tests (red)",
    body: "Wrote refresh.test.ts; 4 assertions fail against the stub.",
    trailer: {
      v: 1,
      id: "ASDLC-1",
      task: 2,
      seq: 1,
      ref: "T1/phase-test",
      agent: "phase-test",
      loop: "test",
      round: 1,
      outcome: "red",
      t_pass: 0,
      t_fail: 4,
      red: "assertion",
      files: 1,
      add_test: 130,
      harness: "pi",
      model: "sonnet",
      spawns: 1,
      tok_in: 9000,
      tok_out: 2100,
      usd_u: 61000,
      ms: 30000,
      usage: "host",
    },
  },
  {
    name: "T1/review-test",
    summary: "1 critical, 2 warning",
    body: [
      "F-001 critical tests/refresh.test.ts:42  asserts on the mock, not behaviour (AC-3)",
      "F-002 warning  tests/refresh.test.ts:70  no expired-token case (AC-4)",
      "F-003 warning  tests/refresh.test.ts:91  test name does not state the expected result",
    ].join("\n"),
    trailer: {
      v: 1,
      id: "ASDLC-1",
      task: 2,
      seq: 2,
      ref: "T1/review-test",
      agent: "review-test",
      loop: "test",
      round: 1,
      outcome: "findings",
      crit: 1,
      warn: 2,
      sugg: 0,
      open_crit: 1,
      open_warn: 2,
      findings: ["F-001", "F-002", "F-003"],
      ac: ["AC-3", "AC-4"],
      files: 1,
      harness: "pi",
      model: "sonnet",
      spawns: 1,
      tok_in: 18200,
      tok_out: 1900,
      tok_cache_r: 12000,
      tok_cache_w: 0,
      usd_u: 118000,
      ms: 41200,
      usage: "host",
    },
  },
  {
    name: "C1/review-security (with x_ key)",
    summary: "1 warning, 1 suggestion",
    body: [
      "F-004 warning    src/refresh.ts:12  token logged at debug level",
      "F-005 suggestion src/refresh.ts:30  prefer constant-time compare",
    ].join("\n"),
    trailer: {
      v: 1,
      id: "ASDLC-1",
      task: 2,
      seq: 3,
      ref: "C1/review-security",
      agent: "review-security",
      loop: "code",
      round: 1,
      outcome: "findings",
      crit: 0,
      warn: 1,
      sugg: 1,
      open_crit: 0,
      open_warn: 1,
      findings: ["F-004", "F-005"],
      files: 1,
      harness: "pi",
      model: "opus",
      spawns: 1,
      tok_in: 7000,
      tok_out: 800,
      usd_u: 90000,
      ms: 20000,
      usage: "host",
      x_team: "platform",
    },
  },
  {
    name: "V1/phase-verify-task",
    summary: "pass, 4 of 4 criteria",
    body: "All acceptance criteria verified.",
    trailer: {
      v: 1,
      id: "ASDLC-1",
      task: 2,
      seq: 4,
      ref: "V1/phase-verify-task",
      agent: "phase-verify-task",
      loop: "verify",
      round: 1,
      outcome: "pass",
      t_pass: 12,
      t_fail: 0,
      t_ms: 2300,
      ac_pass: 4,
      ac_fail: 0,
      harness: "pi",
      model: "sonnet",
      spawns: 1,
      tok_in: 3000,
      tok_out: 500,
      usd_u: 20000,
      ms: 9000,
      usage: "host",
    },
  },
  {
    name: "state(task-2)",
    summary: "snapshot",
    body: "State snapshot written.",
    trailer: {
      v: 1,
      id: "ASDLC-1",
      task: 2,
      seq: 5,
      ref: "state(task-2)",
      agent: "orchestrator",
      loop: "state",
      round: 1,
      outcome: "done",
    },
  },
  {
    name: "evidence(task-2)",
    summary: "rolled up",
    body: "Evidence asset written.",
    trailer: {
      v: 1,
      id: "ASDLC-1",
      task: 2,
      seq: 6,
      ref: "evidence(task-2)",
      agent: "orchestrator",
      loop: "evidence",
      round: 1,
      outcome: "done",
      rounds_test: 1,
      rounds_code: 1,
      findings_total: 5,
      est_lines: 300,
      act_lines: 340,
    },
  },
];

const REQUIRED = ["v", "id", "task", "seq", "ref", "agent", "loop", "round", "outcome"];
const INTEGER_KEYS = [
  "v",
  "task",
  "seq",
  "round",
  "crit",
  "warn",
  "sugg",
  "open_crit",
  "open_warn",
  "addressed",
  "disputed",
  "wont_fix",
  "verified",
  "reraised",
  "dispute_upheld",
  "wont_fix_accepted",
  "waived",
  "t_pass",
  "t_fail",
  "t_skip",
  "t_ms",
  "ac_pass",
  "ac_fail",
  "files",
  "add_src",
  "del_src",
  "add_test",
  "del_test",
  "spawns",
  "tok_in",
  "tok_out",
  "tok_cache_r",
  "tok_cache_w",
  "usd_u",
  "ms",
  "retry",
  "retry_life",
  "rounds_test",
  "rounds_code",
  "findings_total",
  "est_lines",
  "act_lines",
];
const BASE_LINE = "v=1 id=ASDLC-1 task=2 seq=2 ref=T1/x agent=x loop=test round=1 outcome=red";
const VALID_LINE =
  "v=1 id=ASDLC-1 task=2 seq=2 ref=T1/review-test agent=review-test loop=test round=1 outcome=findings crit=1 warn=2 sugg=0";

function trailerLine(message: string): string[] {
  return message.split("\n").filter((l) => l.startsWith("Accord:"));
}

describe("ASDLC-1/AC-2 ASDLC-1/TC-2 buildCommitMessage golden", () => {
  it("ASDLC-1/AC-2 golden file holds one message per case", () => {
    expect(goldenMessages.length).toBe(CASES.length);
  });

  CASES.forEach((c, index) => {
    it(`ASDLC-1/AC-2 buildCommitMessage equals golden: ${c.name}`, () => {
      const out = buildCommitMessage({ summary: c.summary, body: c.body, trailer: c.trailer });
      expect(out).toBe(goldenMessages[index] as string);
    });

    it(`ASDLC-1/AC-2 parseAccordTrailer round-trips golden: ${c.name}`, () => {
      const parsed = parseAccordTrailer(goldenMessages[index] as string);
      expect(parsed).toEqual(c.trailer);
      expect(
        buildCommitMessage({ summary: c.summary, body: c.body, trailer: parsed as AccordTrailer }),
      ).toBe(goldenMessages[index] as string);
    });

    it(`ASDLC-1/AC-2 trailer is exactly one line, key=value, no spaces in values: ${c.name}`, () => {
      const out = buildCommitMessage({ summary: c.summary, body: c.body, trailer: c.trailer });
      const lines = trailerLine(out);
      expect(lines.length).toBe(1);
      expect(out.trimEnd().split("\n").pop()).toBe(lines[0] as string);
      const tokens = (lines[0] as string).slice("Accord: ".length).split(" ");
      for (const token of tokens) {
        expect(token).toMatch(/^[a-z_0-9]+=[^\s=]+$/);
      }
    });

    it(`ASDLC-1/AC-2 golden trailer passes validation: ${c.name}`, () => {
      const t = c.trailer;
      const findingsCount =
        t.crit !== undefined || t.warn !== undefined || t.sugg !== undefined
          ? Number(t.crit ?? 0) + Number(t.warn ?? 0) + Number(t.sugg ?? 0)
          : undefined;
      const testCounts =
        t.t_pass !== undefined || t.t_fail !== undefined
          ? { pass: Number(t.t_pass ?? 0), fail: Number(t.t_fail ?? 0) }
          : undefined;
      expect(validateTrailer(t, { findingsCount, testCounts })).toEqual({ ok: true, errors: [] });
    });
  });

  it("ASDLC-1/AC-2 absent keys are omitted, never null or undefined text", () => {
    const base = CASES[4] as Case;
    const out = buildCommitMessage({
      summary: base.summary,
      body: base.body,
      trailer: { ...base.trailer, crit: undefined },
    });
    const line = trailerLine(out)[0] as string;
    expect(line).not.toMatch(/null|undefined|crit/);
    expect(line).toBe(
      "Accord: v=1 id=ASDLC-1 task=2 seq=5 ref=state(task-2) agent=orchestrator loop=state round=1 outcome=done",
    );
  });

  it.each([
    ["space in a value", { model: "claude sonnet" }, /space/i],
    ["newline in a value", { model: "a\nb" }, /space/i],
    ["fractional count", { crit: 1.5 }, /integer/i],
    ["negative count", { warn: -1 }, /integer/i],
  ])("ASDLC-1/AC-2 build rejects %s", (_name, extra, message) => {
    const base = CASES[1] as Case;
    expect(() =>
      buildCommitMessage({
        summary: base.summary,
        body: base.body,
        trailer: { ...base.trailer, ...extra },
      }),
    ).toThrow(message);
  });

  it.each([
    ["tab in a value", { model: "a\tb" }, /space/i],
    ["carriage return in a value", { model: "a\rb" }, /space/i],
    ["equals sign in a value", { model: "a=b" }, /=/],
    ["empty string value", { model: "" }, /empty/i],
    ["space in a list item", { findings: ["F 001"] }, /space/i],
    ["comma in a list item", { findings: ["F-001,F-002"] }, /comma/i],
    ["space in an x_ value", { x_team: "plat form" }, /space/i],
    ["invalid key name", { "Bad Key": "x" }, /key/i],
  ])("ASDLC-1/AC-2 build rejects %s", (_name, extra, message) => {
    const base = CASES[1] as Case;
    expect(() =>
      buildCommitMessage({
        summary: base.summary,
        body: base.body,
        trailer: { ...base.trailer, ...extra },
      }),
    ).toThrow(message);
  });

  it("ASDLC-1/AC-2 empty findings array omits the findings key", () => {
    const base = CASES[1] as Case;
    const out = buildCommitMessage({
      summary: base.summary,
      body: base.body,
      trailer: { ...base.trailer, findings: [] },
    });
    const tokens = (trailerLine(out)[0] as string).slice("Accord: ".length).split(" ");
    expect(tokens.map((t) => t.split("=")[0])).not.toContain("findings");
    expect(tokens).toContain("ac=AC-3,AC-4");
  });

  it("ASDLC-1/AC-2 body is optional: no body gives subject, blank line, trailer", () => {
    const base = CASES[0] as Case;
    const out = buildCommitMessage({ summary: base.summary, trailer: base.trailer });
    const goldenLines = (goldenMessages[0] as string).split("\n");
    const trailer = goldenLines[goldenLines.length - 1] as string;
    expect(out).toBe(`${buildSubject(base.trailer, base.summary)}\n\n${trailer}`);
    expect(out).not.toContain("undefined");
  });

  it("ASDLC-1/AC-2 summary containing a newline is rejected", () => {
    const base = CASES[0] as Case;
    expect(() =>
      buildCommitMessage({ summary: "a\nb", body: base.body, trailer: base.trailer }),
    ).toThrow(/newline/i);
  });

  it("ASDLC-1/AC-2 body line starting with Accord: is rejected", () => {
    const base = CASES[0] as Case;
    expect(() =>
      buildCommitMessage({
        summary: base.summary,
        body: "ok line\nAccord: v=1 forged=1",
        trailer: base.trailer,
      }),
    ).toThrow(/Accord:/);
  });

  it("ASDLC-1/AC-2 null count from a JS caller is omitted like undefined", () => {
    const base = CASES[4] as Case;
    const out = buildCommitMessage({
      summary: base.summary,
      body: base.body,
      trailer: { ...base.trailer, crit: null as never },
    });
    expect(trailerLine(out)[0]).toBe(
      "Accord: v=1 id=ASDLC-1 task=2 seq=5 ref=state(task-2) agent=orchestrator loop=state round=1 outcome=done",
    );
  });

  it.each(
    INTEGER_KEYS.flatMap((key) => [1.5, -1, Number.NaN].map((value) => [key, value] as const)),
  )("ASDLC-1/AC-2 build rejects non-integer or negative %s=%p", (key, value) => {
    const base = CASES[1] as Case;
    expect(() =>
      buildCommitMessage({
        summary: base.summary,
        body: base.body,
        trailer: { ...base.trailer, [key]: value },
      }),
    ).toThrow(/integer/i);
  });
});

describe("ASDLC-1/AC-2 round-trip typing", () => {
  const identity = {
    v: 1,
    id: "ASDLC-1",
    task: 2,
    seq: 7,
  };
  const roundTrip = (trailer: AccordTrailer) => {
    const out = buildCommitMessage({ summary: "s", body: "b", trailer });
    const parsed = parseAccordTrailer(out) as AccordTrailer;
    expect(parsed).toEqual(trailer);
    expect(buildCommitMessage({ summary: "s", body: "b", trailer: parsed })).toBe(out);
  };

  it("ASDLC-1/AC-2 C2/phase-code fix keys parse back typed", () => {
    roundTrip({
      ...identity,
      ref: "C2/phase-code",
      agent: "phase-code",
      loop: "code",
      round: 2,
      outcome: "fixed",
      addressed: 2,
      disputed: 0,
      wont_fix: 1,
      fixes: ["F-001", "F-002"],
      add_src: 40,
      del_src: 3,
      del_test: 1,
      t_pass: 4,
      t_fail: 0,
      t_skip: 1,
      retry: 1,
      retry_life: 2,
    });
  });

  it("ASDLC-1/AC-2 T2/review-test verdict keys parse back typed", () => {
    roundTrip({
      ...identity,
      ref: "T2/review-test",
      agent: "review-test",
      loop: "test",
      round: 2,
      outcome: "clean",
      verified: 1,
      reraised: 0,
      dispute_upheld: 1,
      wont_fix_accepted: 1,
      waived: 0,
      findings: ["F-006"],
      ac: ["AC-3"],
    });
  });

  it("ASDLC-1/AC-2 one-item lists parse as arrays", () => {
    const parsed = parseAccordTrailer(`${VALID_LINE} findings=F-001 fixes=F-002`) as AccordTrailer;
    expect(parsed.findings).toEqual(["F-001"]);
    expect(parsed.fixes).toEqual(["F-002"]);
  });
});

describe("ASDLC-1/AC-2 parseAccordTrailer", () => {
  it("ASDLC-1/AC-2 accepts the bare value line (git trailers valueonly form)", () => {
    const parsed = parseAccordTrailer(VALID_LINE);
    expect(parsed).toEqual({
      v: 1,
      id: "ASDLC-1",
      task: 2,
      seq: 2,
      ref: "T1/review-test",
      agent: "review-test",
      loop: "test",
      round: 1,
      outcome: "findings",
      crit: 1,
      warn: 2,
      sugg: 0,
    });
  });

  it("ASDLC-1/AC-2 returns null when a message has no Accord trailer", () => {
    expect(parseAccordTrailer("[ASDLC-1][task-2] T1/phase-test: x\n\nbody only")).toBeNull();
    expect(parseAccordTrailer("")).toBeNull();
  });

  it("ASDLC-1/AC-2 unknown x_ keys are kept on parse", () => {
    const parsed = parseAccordTrailer(`${VALID_LINE} x_team=platform x_n=7`);
    expect(parsed?.x_team).toBe("platform");
    expect(parsed?.x_n).toBe("7");
    expect(parsed?.crit).toBe(1);
  });

  it("ASDLC-1/AC-2 unknown x_ keys are ignored by validation and by counts", () => {
    const parsed = parseAccordTrailer(`${VALID_LINE} x_crit=99 x_t_fail=5`) as AccordTrailer;
    expect(validateTrailer(parsed, { findingsCount: 3 })).toEqual({ ok: true, errors: [] });
  });

  it.each([
    ["token without equals sign", `${VALID_LINE} stray`],
    [
      "non-integer count",
      "v=1 id=ASDLC-1 task=2 seq=2 ref=T1/x agent=x loop=test round=1 outcome=red crit=1.5",
    ],
    [
      "non-numeric count",
      "v=1 id=ASDLC-1 task=2 seq=2 ref=T1/x agent=x loop=test round=1 outcome=red crit=many",
    ],
  ])("ASDLC-1/AC-2 parse throws malformed on %s", (_name, line) => {
    expect(() => parseAccordTrailer(line)).toThrow(/malformed/i);
  });
});

describe("ASDLC-1/AC-2 parse integer-only counts", () => {
  it.each(
    INTEGER_KEYS.flatMap((key) =>
      ["1.5", "many", "-1", "", "1e3", "0x10", "+3"].map((raw) => [key, raw] as const),
    ),
  )("ASDLC-1/AC-2 parse throws malformed on %s=%p", (key, raw) => {
    const tokens = BASE_LINE.split(" ").filter((t) => !t.startsWith(`${key}=`));
    const line = `${tokens.join(" ")} ${key}=${raw}`;
    expect(() => parseAccordTrailer(line)).toThrow(/malformed/i);
  });
});

describe("ASDLC-1/AC-2 validateTrailer", () => {
  it.each(REQUIRED)("ASDLC-1/AC-2 missing required key %s fails validation", (key) => {
    const line = VALID_LINE.split(" ")
      .filter((token) => !token.startsWith(`${key}=`))
      .join(" ");
    const parsed = parseAccordTrailer(line) as AccordTrailer;
    expect(parsed).not.toBeNull();
    const result = validateTrailer(parsed);
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toMatch(new RegExp(`\\b${key}\\b`));
    for (const other of REQUIRED.filter((k) => k !== key)) {
      expect(result.errors[0]).not.toMatch(new RegExp(`\\b${other}\\b`));
    }
  });

  it("ASDLC-1/AC-2 unsupported v fails validation", () => {
    const parsed = parseAccordTrailer(VALID_LINE.replace("v=1", "v=2")) as AccordTrailer;
    const result = validateTrailer(parsed);
    expect(result.ok).toBe(false);
    expect(result.errors.join("\n")).toMatch(/\bv\b.*2|unsupported/i);
  });

  it.each([
    [2, false],
    [3, true],
    [4, false],
    [0, false],
  ])("ASDLC-1/AC-2 crit+warn+sugg=3 vs staged findings %d => ok=%s", (findingsCount, ok) => {
    const parsed = parseAccordTrailer(VALID_LINE) as AccordTrailer;
    const result = validateTrailer(parsed, { findingsCount });
    expect(result.ok).toBe(ok);
    if (!ok) {
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain("crit+warn+sugg");
    }
  });

  it("ASDLC-1/AC-2 findings count is not checked when not supplied", () => {
    const parsed = parseAccordTrailer(VALID_LINE) as AccordTrailer;
    expect(validateTrailer(parsed)).toEqual({ ok: true, errors: [] });
  });

  const TEST_LINE =
    "v=1 id=ASDLC-1 task=2 seq=1 ref=T1/phase-test agent=phase-test loop=test round=1 outcome=red t_pass=0 t_fail=4";

  it.each([
    [{ pass: 0, fail: 4 }, true, ""],
    [{ pass: 0, fail: 3 }, false, "t_fail"],
    [{ pass: 1, fail: 4 }, false, "t_pass"],
    [{ pass: 4, fail: 0 }, false, "both"],
    [{ pass: 2, fail: 2 }, false, "both"],
  ])("ASDLC-1/AC-2 t_pass=0 t_fail=4 vs recorded %j => ok=%s", (testCounts, ok, key) => {
    const parsed = parseAccordTrailer(TEST_LINE) as AccordTrailer;
    const result = validateTrailer(parsed, { testCounts });
    expect(result.ok).toBe(ok);
    if (!ok) {
      const text = result.errors.join("\n");
      if (key === "both") {
        expect(text).toContain("t_pass");
        expect(text).toContain("t_fail");
      } else {
        expect(text).toContain(key);
        expect(text).not.toContain(key === "t_fail" ? "t_pass" : "t_fail");
      }
    }
  });

  it("ASDLC-1/AC-2 missing crit/warn/sugg with staged findings fails; with none passes", () => {
    const noCounts = (CASES[0] as Case).trailer;
    const bad = validateTrailer(noCounts, { findingsCount: 3 });
    expect(bad.ok).toBe(false);
    expect(bad.errors[0]).toContain("crit+warn+sugg");
    expect(validateTrailer(noCounts, { findingsCount: 0 })).toEqual({ ok: true, errors: [] });
  });

  it("ASDLC-1/AC-2 missing t_pass/t_fail with recorded tests fails", () => {
    const noTests = (CASES[4] as Case).trailer;
    const result = validateTrailer(noTests, { testCounts: { pass: 3, fail: 1 } });
    expect(result.ok).toBe(false);
    const text = result.errors.join("\n");
    expect(text).toContain("t_pass");
    expect(text).toContain("t_fail");
  });
});

describe("ASDLC-1/AC-2 subject", () => {
  it.each(CASES.slice(0, 4))("ASDLC-1/AC-2 buildSubject matches documented regex: $name", (c) => {
    const subject = buildSubject(c.trailer, c.summary);
    expect(subject).toBe(`[ASDLC-1][task-2] ${c.trailer.ref}: ${c.summary}`);
    expect(subject).toMatch(SUBJECT_RE);
    expect(goldenMessages[CASES.indexOf(c)]?.split("\n")[0]).toBe(subject);
  });

  it("ASDLC-1/AC-2 buildSubject handles multi-hyphen ids", () => {
    const subject = buildSubject({ ...(CASES[0] as Case).trailer, id: "FOO-BAR-12", task: 7 }, "s");
    expect(subject).toBe("[FOO-BAR-12][task-7] T1/phase-test: s");
    expect(subject).toMatch(SUBJECT_RE);
  });

  it("ASDLC-1/AC-2 parseSubject accepts multi-hyphen id and S ref", () => {
    expect(parseSubject("[FOO-BAR-12][task-7] S1/review-security: x")).toEqual({
      workItemId: "FOO-BAR-12",
      task: 7,
      ref: "S1",
      actor: "review-security",
    });
  });

  it("ASDLC-1/AC-2 parseSubject returns work item, task, ref and actor", () => {
    expect(parseSubject("[ASDLC-1][task-2] T1/review-test: 1 critical, 2 warning")).toEqual({
      workItemId: "ASDLC-1",
      task: 2,
      ref: "T1",
      actor: "review-test",
    });
    expect(parseSubject("[ACCORD-1234][task-12] C2.1/phase-code: fixed")).toEqual({
      workItemId: "ACCORD-1234",
      task: 12,
      ref: "C2.1",
      actor: "phase-code",
    });
  });

  it.each([
    "[ASDLC-1][task-2] evidence(task-2): rolled up",
    "[asdlc-1][task-2] T1/phase-test: x",
    "[ASDLC-1][task-2] t1/phase-test: x",
    "[ASDLC-1][task-2] X1/phase-test: x",
    "[ASDLC-1][task-x] T1/phase-test: x",
    "[ASDLC-1][task-2] T1/phase-test:x",
    "[ASDLC][task-2] T1/phase-test: x",
    "random subject",
    "x[ASDLC-1][task-2] T1/phase-test: y",
  ])("ASDLC-1/AC-2 parseSubject rejects %p", (subject) => {
    expect(parseSubject(subject)).toBeNull();
  });
});

describe("ASDLC-1/AC-2 ASDLC-1/TC-2 documented awk extraction over git log", () => {
  let repo: TempGitRepo | undefined;
  afterEach(async () => {
    await repo?.cleanup();
    repo = undefined;
  });

  const AWK = `$2!="" {
  n=split($2,p," "); delete r
  for(i=1;i<=n;i++){split(p[i],kv,"="); r[kv[1]]=kv[2]}
  if (r["outcome"]=="findings") { crit[r["loop"]]+=r["crit"]; warn[r["loop"]]+=r["warn"] }
  if (r["round"]+0 > rounds[r["loop"]]) rounds[r["loop"]]=r["round"]
  usd[r["agent"]]+=r["usd_u"]; tok[r["model"]]+=r["tok_in"]+r["tok_out"]
}
END { for (l in rounds) printf "%s rounds=%d crit=%d warn=%d\\n", l, rounds[l], crit[l], warn[l]
      for (a in usd) printf "%s usd=%.2f\\n", a, usd[a]/1e6
      for (m in tok) printf "%s tokens=%d\\n", m, tok[m] }`;

  function sh(dir: string, script: string): string {
    const env: Record<string, string | undefined> = {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    };
    for (const key of Object.keys(env)) {
      if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|OBJECT_DIRECTORY|COMMON_DIR|NAMESPACE)$/.test(key)) {
        delete env[key];
      }
    }
    const res = spawnSync("bash", ["-c", script], { cwd: dir, encoding: "utf8", env });
    if (res.status !== 0) throw new Error(`${script} failed: ${res.stderr}`);
    return res.stdout;
  }

  it("ASDLC-1/AC-2 awk extraction equals awk-extract.golden.txt and parseAccordTrailer sums", async () => {
    repo = await createTempGitRepo();
    await repo.commitFiles({ "README.md": "init" }, "init: no trailer");
    // Messages are built by the grammar, not copied from the golden file.
    for (const c of CASES) {
      await repo.commitFiles(
        { [`f${c.trailer.seq}.txt`]: String(c.trailer.seq) },
        buildCommitMessage({ summary: c.summary, body: c.body, trailer: c.trailer }),
      );
    }

    const out = sh(
      repo.dir,
      `git log --reverse --format='%H%x09%(trailers:key=Accord,valueonly,unfold)' | awk -F'\\t' '${AWK}' | LC_ALL=C sort`,
    );
    expect(out).toBe(awkGolden);

    // git's own trailer parsing yields exactly the built one-line trailer, in order.
    const values = sh(
      repo.dir,
      `git log --reverse --format='%(trailers:key=Accord,valueonly,unfold)'`,
    )
      .split("\n")
      .filter((l) => l !== "");
    expect(values.length).toBe(CASES.length);
    values.forEach((value, index) => {
      expect(parseAccordTrailer(value)).toEqual((CASES[index] as Case).trailer);
    });

    // parseAccordTrailer-based sums equal the awk numbers.
    const messages = sh(repo.dir, `git log --reverse --format='%B%x00'`)
      .split("\0")
      .map((m) => m.trim())
      .filter((m) => m !== "");
    const crit: Record<string, number> = {};
    const warn: Record<string, number> = {};
    const usd: Record<string, number> = {};
    const tok: Record<string, number> = {};
    for (const message of messages) {
      const t = parseAccordTrailer(message);
      if (!t) continue;
      if (t.outcome === "findings") {
        crit[t.loop] = (crit[t.loop] ?? 0) + Number(t.crit ?? 0);
        warn[t.loop] = (warn[t.loop] ?? 0) + Number(t.warn ?? 0);
      }
      usd[t.agent] = (usd[t.agent] ?? 0) + Number(t.usd_u ?? 0);
      const model = String(t.model ?? "");
      tok[model] = (tok[model] ?? 0) + Number(t.tok_in ?? 0) + Number(t.tok_out ?? 0);
    }
    expect(crit).toEqual({ test: 1, code: 0 });
    expect(warn).toEqual({ test: 2, code: 1 });
    expect(usd).toEqual({
      "phase-test": 61000,
      "review-test": 118000,
      "review-security": 90000,
      "phase-verify-task": 20000,
      orchestrator: 0,
    });
    expect(tok).toEqual({ sonnet: 34700, opus: 7800, "": 0 });
  });
});
