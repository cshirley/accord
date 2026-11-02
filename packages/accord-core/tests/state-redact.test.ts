import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import { capBytes, redactTaskFile } from "../src/state/redact.js";

const here = dirname(fileURLToPath(import.meta.url));
const taskSchema = JSON.parse(
  readFileSync(join(here, "..", "schemas", "task-schema.json"), "utf8"),
);
const examplePath = join(here, "..", "schemas", "task-file.example.json");

// Seeds are built at runtime so no full token is ever committed.
const ghToken = `${"gh"}p_${"A1b2".repeat(9)}`;
const patToken = `${"github"}_pat_${"Ab1_".repeat(8)}`;
const antToken = `${"sk"}-ant-${"Zx9-Yw8_".repeat(4)}`;
const awsToken = `${"AK"}IA${"ABCDEFGH12345678"}`;
const ENV_NAME = "ASDLC1_STATE_TEST_SECRET";
const ENV_VALUE = "envSecretValue-98765";
const home = `/${"Users"}/${"jane.doe"}/src/proj`;

let savedEnv: string | undefined;
beforeEach(() => {
  savedEnv = process.env[ENV_NAME];
  process.env[ENV_NAME] = ENV_VALUE;
});
afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV_NAME];
  else process.env[ENV_NAME] = savedEnv;
});

function seeded(): Record<string, unknown> {
  return {
    schema_version: "2.0",
    work_item: "ASDLC-1",
    task: 33,
    title: "benign title",
    summary: { headline: "all good" },
    control: {
      phase: "phase-test",
      in_flight: null,
      last_prompt: `do thing with ${ghToken}`,
      prompt: `use ${patToken}`,
    },
    log: [
      {
        ref: "T1/phase-test",
        test_output: `FAIL at ${home}/a.ts\nAuthorization: Bearer ${"Zm9v".repeat(8)}\nkey ${antToken}\nenv ${ENV_VALUE}\n${awsToken}`,
        prompt: `p ${ghToken}`,
        transcript: [{ role: "user", content: `t ${ghToken}` }],
        raw_packet: { status: "done", note: ghToken },
        raw_packets: [{ note: patToken }],
      },
    ],
  };
}

const SECRETS = [ghToken, patToken, antToken, awsToken, ENV_VALUE, "jane.doe", "Zm9vZm9v"];

describe("ASDLC-1/AC-12 redactTaskFile", () => {
  it("ASDLC-1/AC-12 removes or masks every seeded secret", () => {
    const { value } = redactTaskFile(seeded());
    const json = JSON.stringify(value);
    for (const secret of SECRETS) expect(json).not.toContain(secret);
  });

  it("ASDLC-1/AC-12 drops prompt, transcript and raw packet fields", () => {
    const { value } = redactTaskFile(seeded());
    const json = JSON.stringify(value);
    for (const key of ["prompt", "transcript", "raw_packet", "raw_packets", "last_prompt"]) {
      expect(json).not.toContain(`"${key}"`);
    }
    const entry = (value.log as Record<string, unknown>[])[0];
    expect(Object.keys(entry).sort()).toEqual(["ref", "test_output"]);
  });

  it("ASDLC-1/AC-12 counts redactions in test output (at least token, bearer, env, aws, home)", () => {
    const { value, redactions } = redactTaskFile(seeded());
    // 5 masked in test_output + 6 removed (last_prompt, control.prompt, prompt, transcript, raw_packet, raw_packets)
    expect(redactions).toBeGreaterThanOrEqual(11);
    const out = (value.log as { test_output: string }[])[0].test_output;
    expect(out).toContain("[REDACTED]");
    expect(out).toContain("FAIL at");
  });

  it("ASDLC-1/AC-12 keeps benign fields and in_flight null unchanged", () => {
    const { value } = redactTaskFile(seeded());
    expect(value.schema_version).toBe("2.0");
    expect(value.work_item).toBe("ASDLC-1");
    expect(value.task).toBe(33);
    expect(value.title).toBe("benign title");
    expect(value.summary).toEqual({ headline: "all good" });
    expect((value.control as Record<string, unknown>).in_flight).toBeNull();
    expect((value.control as Record<string, unknown>).phase).toBe("phase-test");
  });

  it("ASDLC-1/AC-12 benign task file yields zero redactions and equal value", () => {
    const benign = {
      schema_version: "2.0",
      work_item: "ASDLC-1",
      task: 1,
      title: "plain",
      log: [{ ref: "T1/phase-test", test_output: "3 pass 0 fail" }],
    };
    const { value, redactions } = redactTaskFile(structuredClone(benign));
    expect(redactions).toBe(0);
    expect(value).toEqual(benign);
  });

  it("ASDLC-1/AC-12 is idempotent", () => {
    const first = redactTaskFile(seeded());
    const second = redactTaskFile(structuredClone(first.value));
    expect(second.value).toEqual(first.value);
    expect(second.redactions).toBe(0);
  });

  it("ASDLC-1/AC-12 is pure: input object not mutated", () => {
    const input = seeded();
    const snapshot = structuredClone(input);
    redactTaskFile(input);
    expect(input).toEqual(snapshot);
  });
});

describe("ASDLC-1/AC-12 capBytes", () => {
  it("ASDLC-1/AC-12 text at or below the cap is unchanged", () => {
    expect(capBytes("abcde", 5).value).toBe("abcde");
    expect(capBytes("abc", 100).value).toBe("abc");
    expect(capBytes("", 10).value).toBe("");
  });

  it("ASDLC-1/AC-12 text above the cap is truncated with a marker within the cap", () => {
    const text = "x".repeat(5000);
    const { value } = capBytes(text, 1000);
    expect(Buffer.byteLength(value, "utf8")).toBeLessThanOrEqual(1000);
    expect(value).toMatch(/truncated/i);
    expect(value.startsWith("x".repeat(100))).toBe(true);
    expect(Buffer.byteLength(value, "utf8")).toBeGreaterThanOrEqual(1000 - 64);
  });

  it("ASDLC-1/AC-12 one byte over the cap is truncated", () => {
    const { value } = capBytes("y".repeat(1001), 1000);
    expect(value).toMatch(/truncated/i);
    expect(Buffer.byteLength(value, "utf8")).toBeLessThanOrEqual(1000);
  });

  it("ASDLC-1/AC-12 counts bytes not characters and keeps valid UTF-8", () => {
    const text = "é".repeat(2000); // 4000 bytes
    const { value } = capBytes(text, 1000);
    expect(Buffer.byteLength(value, "utf8")).toBeLessThanOrEqual(1000);
    expect(value).not.toContain("\uFFFD");
  });

  it("ASDLC-1/AC-12 capping is idempotent", () => {
    const once = capBytes("z".repeat(5000), 1000).value;
    expect(capBytes(once, 1000).value).toBe(once);
  });
});

type Obj = Record<string, any>;

function schemaValidBase(): Obj {
  return structuredClone(JSON.parse(readFileSync(examplePath, "utf8")));
}

function containsKey(node: unknown, key: string): boolean {
  if (Array.isArray(node)) return node.some((item) => containsKey(item, key));
  if (node && typeof node === "object") {
    return Object.entries(node).some(([name, child]) => name === key || containsKey(child, key));
  }
  return false;
}

const ctx = (secret: string) => `see ${secret} here`;

function plantedFile(): { task: Obj; planted: string[] } {
  const task = schemaValidBase();
  const requirement = task.requirements[0];
  const finding = requirement.findings[0];
  task.summary.headline = ctx(antToken);
  task.summary.next.do = [ctx(antToken)];
  task.summary.next.why = ctx(ghToken);
  task.summary.blockers = [
    { finding: "F-001", ac: "AC-1", severity: "critical", state: "open", issue: ctx(antToken) },
  ];
  task.control.blocked = { kind: "manual", reason: ctx(antToken), ref: "T1/harness" };
  finding.detail = { evidence: ctx(antToken) };
  finding.history[0].note = ctx(antToken);
  requirement.verification.command = ctx(antToken);
  requirement.verification.tests = [ctx(antToken)];
  task.log[0].note = ctx(antToken);
  task.log[0].warnings = [ctx(antToken)];
  task.log[0].events[0].extra = ctx(antToken);
  // keys to drop: top level, deep in events, deep in findings, in log entry (schema forbids extras here)
  task.prompt = `p ${ghToken}`;
  task.log[0].events[0].transcript = [{ content: ghToken }];
  finding.raw_packet = { note: ghToken };
  const planted = [
    "summary.headline",
    "summary.next.do[0]",
    "summary.next.why",
    "summary.blockers[0].issue",
    "control.blocked.reason",
    "findings[0].detail.evidence",
    "findings[0].history[0].note",
    "verification.command",
    "verification.tests[0]",
    "log[0].note",
    "log[0].warnings[0]",
    "log[0].events[0].extra",
  ];
  return { task, planted };
}

describe("ASDLC-1/AC-12 redactTaskFile on a schema-valid task file", () => {
  it("ASDLC-1/AC-12 masks secrets in every real free-text location, drops deep keys, stays schema-valid", () => {
    const { task, planted } = plantedFile();
    const { value, redactions } = redactTaskFile(task);
    const json = JSON.stringify(value);

    // (1) no secret anywhere
    for (const secret of [ghToken, patToken, antToken, awsToken, ENV_VALUE]) {
      expect(json).not.toContain(secret);
    }
    // (2) no dropped key anywhere
    for (const key of ["prompt", "transcript", "raw_packet"]) {
      expect(containsKey(value, key)).toBe(false);
    }
    // (3) masked, not wiped
    const req = (value.requirements as Obj[])[0];
    const log0 = (value.log as Obj[])[0];
    const summary = value.summary as Obj;
    const strings = [
      summary.headline,
      summary.next.do[0],
      summary.next.why,
      summary.blockers[0].issue,
      (value.control as Obj).blocked.reason,
      req.findings[0].detail.evidence,
      req.findings[0].history[0].note,
      req.verification.command,
      req.verification.tests[0],
      log0.note,
      log0.warnings[0],
      log0.events[0].extra,
    ];
    expect(strings).toHaveLength(planted.length);
    for (const text of strings) {
      expect(typeof text).toBe("string");
      expect(text).toContain("see ");
      expect(text).toContain("[REDACTED]");
    }
    // (4) schema-valid
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(taskSchema);
    const ok = validate(value);
    expect(ok ? [] : validate.errors).toEqual([]);
    // (5) every planted secret + 3 dropped keys counted
    expect(redactions).toBeGreaterThanOrEqual(planted.length);
    expect((value.control as Obj).in_flight).toBeNull();
  });

  it("ASDLC-1/AC-12 redacted schema-valid file is idempotent", () => {
    const first = redactTaskFile(plantedFile().task);
    const second = redactTaskFile(structuredClone(first.value));
    expect(second.value).toEqual(first.value);
    expect(second.redactions).toBe(0);
  });

  it.each(["system_prompt", "prompts", "transcripts", "raw_return_packet"])(
    "ASDLC-1/AC-12 drops %s under a log entry",
    (key) => {
      const task = schemaValidBase();
      task.log[0][key] = [{ note: ghToken }];
      const { value } = redactTaskFile(task);
      expect(containsKey(value, key)).toBe(false);
      expect(JSON.stringify(value)).not.toContain(ghToken);
    },
  );

  it("ASDLC-1/AC-12 JSON-special characters in env secrets and notes do not leak or break output", () => {
    const name = "ASDLC1_STATE_TEST_TOKEN";
    const saved = process.env[name];
    const secret = `pa${'"'}ss${"\\"}word-12345`;
    process.env[name] = secret;
    try {
      const task = schemaValidBase();
      task.control.blocked = { kind: "manual", reason: `r ${secret} end`, ref: "T1/harness" };
      task.log[0].note = 'TOKEN=abc"rest';
      let result: ReturnType<typeof redactTaskFile> | undefined;
      expect(() => {
        result = redactTaskFile(task);
      }).not.toThrow();
      const value = result?.value as Obj;
      expect(value.control.blocked.reason).not.toContain(secret);
      expect(value.control.blocked.reason).toContain("[REDACTED]");
      expect(JSON.stringify(value)).not.toContain(JSON.stringify(secret).slice(1, -1));
      expect(typeof value.log[0].note).toBe("string");
    } finally {
      if (saved === undefined) delete process.env[name];
      else process.env[name] = saved;
    }
  });
});

const utf8Rows: [string, string, number][] = [
  ["é x800", "é".repeat(800), 1000],
  ["é x2000", "é".repeat(2000), 999],
  ["é x2000", "é".repeat(2000), 1001],
  ...[1000, 1001, 1002].map((cap): [string, string, number] => ["€ x1000", "€".repeat(1000), cap]),
  ...[1000, 1001, 1002, 1003].map((cap): [string, string, number] => [
    "😀 x500",
    "😀".repeat(500),
    cap,
  ]),
];

describe("ASDLC-1/AC-12 capBytes multi-byte input", () => {
  it.each(utf8Rows)(
    "ASDLC-1/AC-12 truncates %s at cap %d to valid UTF-8 within cap",
    (_label, text, cap) => {
      const { value } = capBytes(text, cap);
      expect(Buffer.byteLength(value, "utf8")).toBeLessThanOrEqual(cap);
      expect(value).toMatch(/truncated/i);
      expect(value).not.toContain("\uFFFD");
      expect(
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value),
      ).toBe(false);
      expect(Buffer.from(value, "utf8").toString("utf8")).toBe(value);
    },
  );

  it("ASDLC-1/AC-12 multi-byte text exactly at the cap is unchanged", () => {
    const text = "é".repeat(500); // 1000 bytes
    expect(capBytes(text, 1000).value).toBe(text);
  });
});

describe("ASDLC-1/AC-12 capBytes cap smaller than marker", () => {
  it.each([1, 5, 10, 20])("ASDLC-1/AC-12 cap %d is never exceeded", (cap) => {
    const { value } = capBytes("x".repeat(100), cap);
    expect(Buffer.byteLength(value, "utf8")).toBeLessThanOrEqual(cap);
  });
});
