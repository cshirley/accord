import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { redactText } from "../src/state/redact.js";

// Seeds are built at runtime so no full token is ever committed.
const alnum36 = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8".slice(0, 36);
const seeds = {
  github: `${"gh"}p_${"A1b2".repeat(9)}`,
  githubS: `${"gh"}s_${alnum36}`,
  githubO: `${"gh"}o_${alnum36}`,
  githubU: `${"gh"}u_${alnum36}`,
  githubR: `${"gh"}r_${alnum36}`,
  githubPat: `${"github"}_pat_${"Ab1_".repeat(8)}`,
  openai: `${"sk"}-${"Qw3rTy".repeat(6)}`,
  openaiProj: `${"sk"}-proj-${"Ab3_-Xy9Zq".repeat(4)}`,
  anthropic: `${"sk"}-ant-${"Zx9-Yw8_".repeat(4)}`,
  aws: `${"AK"}IA${"ABCDEFGH12345678".slice(0, 16)}`,
  awsSession: `${"AS"}IA${"ZYXWVUTS98765432".slice(0, 16)}`,
  bearer: `${"Zm9v".repeat(8)}.${"YmFy".repeat(4)}`,
  assigned: "hunter2.Hun/ter+2!xyz",
};

const ENV_NAMES = [
  "ASDLC1_TEST_SECRET",
  "ASDLC1_TEST_TOKEN_SHORT",
  "ASDLC1_TEST_COLOR",
  "ASDLC1_TEST_EDGE_PASSWORD",
  "ASDLC1_TEST_MONKEY_NAME",
];
const saved: Record<string, string | undefined> = {};
const ENV_LONG = "envSecretValue-98765";

// The one pinned mask syntax: [REDACTED] with an optional label inside the brackets.
const MASK = String.raw`\[REDACTED[^\]]*\]`;
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
}
/** Anchored shape: prefix + one mask + suffix, with the secret removed from the input. */
function shape(prefix: string, suffix = ""): RegExp {
  return new RegExp(`^${escapeRegExp(prefix)}${MASK}${escapeRegExp(suffix)}$`);
}

beforeEach(() => {
  for (const name of ENV_NAMES) saved[name] = process.env[name];
  process.env.ASDLC1_TEST_SECRET = ENV_LONG;
  process.env.ASDLC1_TEST_TOKEN_SHORT = "short12"; // 7 chars: below the 8 minimum
  process.env.ASDLC1_TEST_COLOR = "longcolorvalue"; // long, but the name does not match
  delete process.env.ASDLC1_TEST_EDGE_PASSWORD;
  delete process.env.ASDLC1_TEST_MONKEY_NAME;
});
afterEach(() => {
  for (const name of ENV_NAMES) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

describe("ASDLC-1/AC-12 redactText masks secrets and counts them", () => {
  // [label, prefix, secret, suffix]
  const cases: Array<[string, string, string, string]> = [
    ["GitHub ghp token", "token is ", seeds.github, " ok"],
    ["GitHub ghs token", "token is ", seeds.githubS, " ok"],
    ["GitHub gho token", "token is ", seeds.githubO, " ok"],
    ["GitHub ghu token", "token is ", seeds.githubU, " ok"],
    ["GitHub ghr token", "token is ", seeds.githubR, " ok"],
    ["GitHub fine-grained token", "pat ", seeds.githubPat, " end"],
    ["OpenAI-style key", "key ", seeds.openai, " end"],
    ["OpenAI project key", "key ", seeds.openaiProj, " end"],
    ["Anthropic-style key", "key ", seeds.anthropic, " end"],
    ["AWS access key id AKIA", "aws ", seeds.aws, " end"],
    ["AWS session key id ASIA", "aws ", seeds.awsSession, " end"],
    ["Bearer header", "Authorization: Bearer ", seeds.bearer, ""],
    ["KEY=value assignment (PASSWORD)", "DB_PASSWORD=", seeds.assigned, ""],
    ["KEY=value assignment (TOKEN)", "export MY_TOKEN=", seeds.assigned, ""],
    ["KEY=value assignment (PRIVATE)", "SOME_PRIVATE=", seeds.assigned, ""],
    ["KEY=value assignment (CREDENTIAL)", "X_CREDENTIAL=", seeds.assigned, ""],
    ["KEY=value assignment (SECRET)", "APP_SECRET=", seeds.assigned, ""],
    ["KEY=value assignment (KEY)", "API_KEY=", seeds.assigned, ""],
    ["environment variable value", "leaked ", ENV_LONG, " here"],
  ];
  for (const [label, prefix, secret, suffix] of cases) {
    it(`${label} is fully masked, surrounding text kept, counted once`, () => {
      const result = redactText(`${prefix}${secret}${suffix}`);
      expect(result.value).toMatch(shape(prefix, suffix));
      expect(result.redactions).toBe(1);
    });
  }

  it.each([
    ["double-quoted", '"'],
    ["single-quoted", "'"],
  ])("%s KEY=value assignment masks the value, keeps API_KEY, counts once", (_label, quote) => {
    const result = redactText(`API_KEY=${quote}${seeds.assigned}${quote}`);
    expect(result.value).toMatch(
      new RegExp(`^API_KEY=${escapeRegExp(quote)}?${MASK}${escapeRegExp(quote)}?$`),
    );
    for (const fragment of ["hunter2", "Hun/ter", "ter+2", "2!xyz"]) {
      expect(result.value).not.toContain(fragment);
    }
    expect(result.redactions).toBe(1);
  });

  it("masks /Users/<name>/ and /home/<name>/ paths", () => {
    const result = redactText("a /Users/alicesmith/src/x and /home/bobjones/y");
    expect(result.value).not.toContain("alicesmith");
    expect(result.value).not.toContain("bobjones");
    expect(result.value).toContain("/src/x");
    expect(result.value).toContain("/y");
    expect(result.redactions).toBe(2);
  });

  it("counts every occurrence of several distinct secrets", () => {
    const text = [
      seeds.github,
      seeds.aws,
      `Bearer ${seeds.bearer}`,
      `API_KEY=${seeds.assigned}`,
    ].join("\n");
    const result = redactText(text);
    for (const secret of [seeds.github, seeds.aws, seeds.bearer, seeds.assigned]) {
      expect(result.value).not.toContain(secret);
    }
    expect(result.redactions).toBe(4);
  });

  it("masks repeated occurrences of the same value", () => {
    const result = redactText(`${seeds.github} and ${seeds.github}`);
    expect(result.value).toMatch(new RegExp(`^${MASK} and ${MASK}$`));
    expect(result.redactions).toBe(2);
  });

  // F-006: boundaries of the env-value and home-path rules.
  const edgeRows: Array<[string, string | undefined, string, string[], string[]]> = [
    ["env value of exactly 8 chars", "abcd1234", "x abcd1234 y", ["abcd1234"], ["x ", " y"]],
    [
      "env value with regex metacharacters",
      "p(a[s$s.w*o+rd",
      "x p(a[s$s.w*o+rd y",
      ["p(a[s$s.w*o+rd"],
      ["x ", " y"],
    ],
    ["username with a dot", undefined, "/Users/clive.shirley/src/x", ["clive.shirley"], ["/src/x"]],
    ["username with a hyphen", undefined, "/home/first-last2/y", ["first-last2"], ["/y"]],
  ];
  it.each(edgeRows)("%s", (_label, envValue, input, absent, kept) => {
    if (envValue !== undefined) process.env.ASDLC1_TEST_EDGE_PASSWORD = envValue;
    let result: ReturnType<typeof redactText> | undefined;
    expect(() => {
      result = redactText(input);
    }).not.toThrow();
    for (const fragment of absent) expect(result?.value).not.toContain(fragment);
    for (const fragment of kept) expect(result?.value).toContain(fragment);
    expect(result?.redactions).toBe(1);
  });

  it("env name matching is by substring: MONKEY_NAME (contains KEY) is masked", () => {
    process.env.ASDLC1_TEST_MONKEY_NAME = "monkeyvalue99";
    const result = redactText("see monkeyvalue99 here");
    expect(result.value).toMatch(shape("see ", " here"));
    expect(result.redactions).toBe(1);
  });
});

describe("ASDLC-1/AC-12 redactText leaves benign text and short or unrelated env values alone", () => {
  it("benign text is unchanged with zero redactions", () => {
    const text =
      "Run bun test in packages/accord-core. SHELL=/bin/zsh DEBUG=true N=1\nsk-short is not a key; ghp_ alone too.";
    const result = redactText(text);
    expect(result.value).toBe(text);
    expect(result.redactions).toBe(0);
  });

  it("env value shorter than 8 characters is not masked", () => {
    const text = "value short12 appears";
    const result = redactText(text);
    expect(result.value).toBe(text);
    expect(result.redactions).toBe(0);
  });

  it("env value whose name does not match the sensitive pattern is not masked", () => {
    const text = "color longcolorvalue appears";
    const result = redactText(text);
    expect(result.value).toBe(text);
    expect(result.redactions).toBe(0);
  });

  it("common non-secret env values ('1', 'true', '/bin/zsh') are never masked", () => {
    process.env.ASDLC1_TEST_SECRET = "true";
    const text = "flag true count 1 shell /bin/zsh";
    const result = redactText(text);
    expect(result.value).toBe(text);
    expect(result.redactions).toBe(0);
  });
});

describe("ASDLC-1/AC-12 redactText is idempotent", () => {
  it("second pass changes nothing and counts zero", () => {
    const text = [
      seeds.github,
      seeds.openai,
      seeds.anthropic,
      seeds.githubS,
      seeds.openaiProj,
      seeds.awsSession,
      `API_KEY="${seeds.assigned}"`,
      `Authorization: Bearer ${seeds.bearer}`,
      `API_KEY=${seeds.assigned}`,
      `/Users/alicesmith/x`,
      `/home/bobjones/y`,
      ENV_LONG,
    ].join("\n");
    const first = redactText(text);
    expect(first.redactions).toBe(12);
    const second = redactText(first.value);
    expect(second.value).toBe(first.value);
    expect(second.redactions).toBe(0);
  });
});

describe("private key blocks", () => {
  it("redacts a PEM private key block", () => {
    const begin = `-----BEGIN ${"OPENSSH PRIVATE"} KEY-----`;
    const end = `-----END ${"OPENSSH PRIVATE"} KEY-----`;
    const text = `before\n${begin}\nb3BlbnNzaC1rZXktdjEAAAAA\nAAAABG5vbmUAAAAEbm9uZQ\n${end}\nafter`;
    const result = redactText(text);
    expect(result.value).toBe("before\n[REDACTED]\nafter");
    expect(result.redactions).toBe(1);
  });
});
