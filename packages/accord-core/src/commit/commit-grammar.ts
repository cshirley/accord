/** Accord trailer, v=1. Counts are integers; absent keys are omitted, never null. Unknown `x_` keys are kept. */
export interface AccordTrailer {
  v: number;
  id: string;
  task: number;
  seq: number;
  ref: string;
  agent: string;
  loop: string;
  round: number;
  outcome: string;
  findings?: string[];
  fixes?: string[];
  ac?: string[];
  [key: string]: string | number | string[] | undefined;
}

export interface TrailerValidation {
  ok: boolean;
  errors: string[];
}

export interface ValidateContext {
  findingsCount?: number;
  testCounts?: { pass: number; fail: number };
}

export interface ParsedSubject {
  workItemId: string;
  task: number;
  ref: string;
  actor: string;
}

export interface CommitMessageInput {
  summary: string;
  body?: string;
  trailer: AccordTrailer;
}

const INTEGER_KEYS = new Set([
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
]);
const LIST_KEYS = new Set(["findings", "fixes", "ac"]);
const REQUIRED_KEYS = ["v", "id", "task", "seq", "ref", "agent", "loop", "round", "outcome"];
const KEY_ORDER = [
  ...REQUIRED_KEYS,
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
  "findings",
  "fixes",
  "ac",
  "t_pass",
  "t_fail",
  "t_skip",
  "t_ms",
  "red",
  "ac_pass",
  "ac_fail",
  "files",
  "add_src",
  "del_src",
  "add_test",
  "del_test",
  "harness",
  "model",
  "spawns",
  "tok_in",
  "tok_out",
  "tok_cache_r",
  "tok_cache_w",
  "usd_u",
  "ms",
  "usage",
  "retry",
  "retry_life",
  "rounds_test",
  "rounds_code",
  "findings_total",
  "est_lines",
  "act_lines",
];
const KEY_RE = /^[a-z][a-z_0-9]*$/;
const SUBJECT_RE =
  /^\[([A-Z]+(?:-[A-Z]+)*-[0-9]+)\]\[task-([0-9]+)\] ([TCVS][0-9]+(?:\.[0-9]+)?)\/([a-z-]+): /;
const PREFIX = "Accord: ";

function checkScalar(key: string, value: string): void {
  if (value === "") throw new Error(`Accord trailer: empty value for ${key}`);
  if (/\s/.test(value)) throw new Error(`Accord trailer: space or whitespace in value of ${key}`);
  if (value.includes("=")) throw new Error(`Accord trailer: '=' in value of ${key}`);
}

function renderValue(key: string, value: unknown): string {
  if (INTEGER_KEYS.has(key)) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      throw new Error(`Accord trailer: ${key} must be a non-negative integer`);
    }
    return String(value);
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = String(item);
      if (text.includes(",")) throw new Error(`Accord trailer: comma in list item of ${key}`);
      checkScalar(key, text);
    }
    return value.join(",");
  }
  const text = String(value);
  checkScalar(key, text);
  return text;
}

function renderTrailerLine(trailer: AccordTrailer): string {
  const record = trailer as Record<string, unknown>;
  const keys = Object.keys(record).filter(
    (key) => record[key] !== undefined && record[key] !== null,
  );
  for (const key of keys) {
    if (!KEY_RE.test(key)) throw new Error(`Accord trailer: invalid key name '${key}'`);
  }
  const rank = (key: string): number => {
    const index = KEY_ORDER.indexOf(key);
    return index >= 0 ? index : key.startsWith("x_") ? KEY_ORDER.length + 1 : KEY_ORDER.length;
  };
  keys.sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
  const tokens: string[] = [];
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value) && value.length === 0) continue;
    tokens.push(`${key}=${renderValue(key, value)}`);
  }
  return `${PREFIX}${tokens.join(" ")}`;
}

export function buildSubject(trailer: AccordTrailer, summary: string): string {
  if (/[\r\n]/.test(summary)) throw new Error("Commit summary must not contain a newline");
  return `[${trailer.id}][task-${trailer.task}] ${trailer.ref}: ${summary}`;
}

export function buildCommitMessage(input: CommitMessageInput): string {
  const subject = buildSubject(input.trailer, input.summary);
  if (input.body?.split(/\r?\n/).some((l) => l.startsWith("Accord:"))) {
    throw new Error("Commit body must not contain a line starting with 'Accord:'");
  }
  const line = renderTrailerLine(input.trailer);
  const body = input.body ? `${input.body}\n\n` : "";
  return `${subject}\n\n${body}${line}`;
}

function malformed(detail: string): Error {
  return new Error(`Accord trailer malformed: ${detail}`);
}

export function parseAccordTrailer(messageOrLine: string): AccordTrailer | null {
  const text = messageOrLine.trim();
  if (text === "") return null;
  let line: string | undefined = text
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(PREFIX))
    ?.slice(PREFIX.length);
  if (line === undefined && !text.includes("\n") && /^[a-z][a-z_0-9]*=/.test(text)) line = text;
  if (line === undefined) return null;
  const result: Record<string, string | number | string[]> = {};
  for (const token of line.trim().split(/\s+/)) {
    const eq = token.indexOf("=");
    if (eq <= 0) throw malformed(`token '${token}' is not key=value`);
    const key = token.slice(0, eq);
    const raw = token.slice(eq + 1);
    if (INTEGER_KEYS.has(key)) {
      if (!/^[0-9]+$/.test(raw)) throw malformed(`${key} must be an integer, got '${raw}'`);
      result[key] = Number(raw);
    } else if (LIST_KEYS.has(key)) {
      result[key] = raw.split(",");
    } else {
      result[key] = raw;
    }
  }
  return result as AccordTrailer;
}

export function validateTrailer(
  trailer: AccordTrailer,
  ctx: ValidateContext = {},
): TrailerValidation {
  const errors: string[] = [];
  const record = trailer as Record<string, unknown>;
  for (const key of REQUIRED_KEYS) {
    if (record[key] === undefined || record[key] === null) {
      errors.push(`missing required key ${key}`);
    }
  }
  if (record.v !== undefined && record.v !== 1) errors.push(`unsupported v=${String(record.v)}`);
  const count = (key: string): number =>
    typeof record[key] === "number" ? (record[key] as number) : 0;
  if (ctx.findingsCount !== undefined) {
    const sum = count("crit") + count("warn") + count("sugg");
    if (sum !== ctx.findingsCount) {
      errors.push(`crit+warn+sugg=${sum} does not equal staged findings ${ctx.findingsCount}`);
    }
  }
  if (ctx.testCounts) {
    if (count("t_pass") !== ctx.testCounts.pass) {
      errors.push(`t_pass=${count("t_pass")} does not equal recorded ${ctx.testCounts.pass}`);
    }
    if (count("t_fail") !== ctx.testCounts.fail) {
      errors.push(`t_fail=${count("t_fail")} does not equal recorded ${ctx.testCounts.fail}`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export function parseSubject(subject: string): ParsedSubject | null {
  const match = SUBJECT_RE.exec(subject);
  if (!match) return null;
  return {
    workItemId: match[1] as string,
    task: Number(match[2]),
    ref: match[3] as string,
    actor: match[4] as string,
  };
}
