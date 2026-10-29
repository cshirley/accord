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
