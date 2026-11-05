export interface RedactResult {
  value: string;
  redactions: number;
}

const MASK = "[REDACTED]";
const SENSITIVE_NAME = "SECRET|TOKEN|KEY|PASSWORD|CREDENTIAL|PRIVATE";
const SENSITIVE_NAME_RE = new RegExp(SENSITIVE_NAME, "i");
const MIN_ENV_VALUE_LENGTH = 8;

const ASSIGNMENT_RE = new RegExp(
  `\\b([A-Za-z0-9_]*(?:${SENSITIVE_NAME})[A-Za-z0-9_]*)=("[^"]*"|'[^']*'|[^\\s"']+)`,
  "g",
);
const BEARER_RE = /\bBearer\s+([A-Za-z0-9._~+/=-]{8,})/g;
const TOKEN_RES: RegExp[] = [
  /\bgh[pousr]_[A-Za-z0-9]{36,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{22,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
];
const HOME_RE = /\/(Users|home)\/([A-Za-z0-9._-]+)\//g;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sensitiveEnvValues(): string[] {
  const values = new Set<string>();
  for (const [name, value] of Object.entries(process.env)) {
    if (
      value !== undefined &&
      value.length >= MIN_ENV_VALUE_LENGTH &&
      SENSITIVE_NAME_RE.test(name)
    ) {
      values.add(value);
    }
  }
  return [...values].sort((a, b) => b.length - a.length);
}

/** Pure text redactor shared by every writer of content that enters git history. */
export function redactText(text: string): RedactResult {
  let redactions = 0;
  let value = text;

  value = value.replace(ASSIGNMENT_RE, (whole, name: string, raw: string) => {
    const quote = raw.startsWith('"') || raw.startsWith("'") ? raw[0] : "";
    const inner = quote ? raw.slice(1, -1) : raw;
    if (inner === "" || inner.startsWith("[REDACTED")) return whole;
    redactions += 1;
    return `${name}=${quote}${MASK}${quote}`;
  });

  value = value.replace(BEARER_RE, (whole, token: string) => {
    if (token.startsWith("[REDACTED")) return whole;
    redactions += 1;
    return `Bearer ${MASK}`;
  });

  for (const tokenRe of TOKEN_RES) {
    value = value.replace(tokenRe, () => {
      redactions += 1;
      return MASK;
    });
  }

  for (const secret of sensitiveEnvValues()) {
    value = value.replace(new RegExp(escapeRegExp(secret), "g"), () => {
      redactions += 1;
      return MASK;
    });
  }

  value = value.replace(HOME_RE, (_whole, root: string) => {
    redactions += 1;
    return `/${root}/${MASK}/`;
  });

  return { value, redactions };
}

export interface RedactTaskFileResult {
  value: Record<string, unknown>;
  redactions: number;
}

const DROPPED_KEY_RE = /prompt|transcript|raw_(?:return_)?packet/i;
const TRUNCATION_MARKER = "\n[truncated]";

function redactNode(node: unknown, counter: { count: number }): unknown {
  if (typeof node === "string") {
    const result = redactText(node);
    counter.count += result.redactions;
    return result.value;
  }
  if (Array.isArray(node)) return node.map((item) => redactNode(item, counter));
  if (node !== null && typeof node === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
      if (DROPPED_KEY_RE.test(key)) {
        counter.count += 1;
        continue;
      }
      out[key] = redactNode(child, counter);
    }
    return out;
  }
  return node;
}

/** Drops prompt/transcript fields and raw packets; redacts every remaining string. */
export function redactTaskFile(task: Record<string, unknown>): RedactTaskFileResult {
  const counter = { count: 0 };
  const value = redactNode(task, counter) as Record<string, unknown>;
  return { value, redactions: counter.count };
}

/** Truncates text above maxBytes (UTF-8) and appends a marker. */
export function capBytes(text: string, maxBytes: number): RedactResult {
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length <= maxBytes) return { value: text, redactions: 0 };
  const marker = Buffer.from(TRUNCATION_MARKER, "utf8");
  const trimEnd = (buf: Buffer): string =>
    Buffer.from(buf)
      .toString("utf8")
      .replace(/\uFFFD+$/, "");
  if (maxBytes <= marker.length) {
    return { value: trimEnd(marker.subarray(0, Math.max(0, maxBytes))), redactions: 0 };
  }
  const head = trimEnd(bytes.subarray(0, maxBytes - marker.length));
  return { value: head + TRUNCATION_MARKER, redactions: 0 };
}
