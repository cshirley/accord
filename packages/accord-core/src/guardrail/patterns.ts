/**
 * Risk pattern definitions and classification for the guardrail.
 *
 * Each pattern belongs to a category with a risk level.
 * Matchers run against the full bash command string.
 */

export type Risk = "high" | "medium";

/**
 * Safe idioms that are approved every single time in practice (never once
 * blocked across months of session history). Checked before classification
 * so they skip the prompt entirely instead of just being "remembered".
 */
const SAFE_PATTERNS: RegExp[] = [
  // lsof + kill -9 on a local dev port, and pkill -f for a named dev process
  /\blsof\s+-ti[:\s]\S+\s*\|\s*xargs\s+-r\s+kill\s+-9\b/i,
  /\bpkill\s+-f\s+["'][^"']+["']/i,
  // force-with-lease is the safe form of force-push
  /\bgit\s+push\b[^\n|;]*--force-with-lease\b/i,
  // curl/wget against localhost/127.0.0.1 — not exfiltration
  /\b(curl|wget)\b[^\n|;]*(127\.0\.0\.1|localhost)\b/i,
  // force-remove a single named container before recreating it (recycle idiom)
  /\bdocker\s+rm\s+-f\s+\S+\s*2>\/dev\/null/i,
  // curl -G + --data-urlencode builds a GET query string, not a POST body
  /\bcurl\b[^\n|;]*\s-G\b/i,
];

/**
 * Matches a bare command word only at the start of a shell statement
 * (string start, or right after `;` `&&` `||` `|` or a newline) \u2014 not
 * anywhere the word happens to appear, e.g. inside a quoted commit message
 * or PR comment body like `-m "graceful shutdown mode"`.
 */
function atStatementStart(word: string): RegExp {
  return new RegExp(`(?:^|[;&|]|\\n)\\s*\\b${word}\\b`, "i");
}

/**
 * Strip heredoc bodies (`<<'EOF' ... EOF`, `<<-EOF ... EOF`, etc.) before
 * classifying. Words like "shutdown", "halt", "sudo" inside file content
 * or commit messages are not commands and shouldn't trigger the gate.
 */
function stripHeredocs(command: string): string {
  return command.replace(/<<-?\s*['"]?(\w+)['"]?\n[\s\S]*?\n\1\b/g, "<<HEREDOC>>");
}

export interface DangerMatch {
  category: string;
  risk: Risk;
  description: string;
  matched: string; // the regex that triggered
}

interface PatternRule {
  category: string;
  risk: Risk;
  description: string;
  patterns: RegExp[];
}

const rules: PatternRule[] = [
  // ── 🔴 High-risk ─────────────────────────────────────────────
  {
    category: "destructive-fs",
    risk: "high",
    description: "Recursive or forced file deletion",
    patterns: [
      // rm -r / -rf / -fr / -f: only matches actual flag tokens (dash then
      // letters only, word-bounded) immediately in the rm argument list —
      // stops at &&, |, ;, newline so it can't cross into unrelated
      // commands, and won't match letters-in-filenames like ".pi-pr-body.md".
      /\brm\s+(?:-[a-zA-Z]+\s+|\S+\s+)*?-[a-zA-Z]*[rf][a-zA-Z]*\b/,
      /\bshred\b/i,
      /\btruncate\s+--size\s+0\b/i,
      /\btruncate\s+-s\s*0\b/i,
    ],
  },
  {
    category: "privilege-escalation",
    risk: "high",
    description: "Elevated privilege execution",
    patterns: [/\bsudo\b/i, /\bsu\s+-/i, /\bdoas\b/i],
  },
  {
    category: "system-control",
    risk: "high",
    description: "System shutdown, reboot, or halt",
    patterns: [
      atStatementStart("shutdown"),
      atStatementStart("reboot"),
      atStatementStart("halt"),
      /\bsystemctl\s+(stop|disable|mask)\b/i,
      /\blaunchctl\s+(unload|remove)\b/i,
    ],
  },
  {
    category: "disk-format",
    risk: "high",
    description: "Low-level disk or partition operations",
    patterns: [
      /\bmkfs\b/i,
      /\bdd\s+if=/i,
      /\bfdisk\b/i,
      /\bdiskutil\s+(eraseDisk|partitionDisk)\b/i,
    ],
  },

  // ── 🟡 Medium-risk ───────────────────────────────────────────
  {
    category: "permission-change",
    risk: "medium",
    description: "Broad or recursive permission/ownership changes",
    patterns: [/\bchmod\b[^\n|;]*777/i, /\bchmod\s+[^\n|;]*-R\b/i, /\bchown\s+[^\n|;]*-R\b/i],
  },
  {
    category: "package-uninstall",
    risk: "medium",
    description: "Uninstalling packages globally",
    patterns: [
      /\bbrew\s+(uninstall|remove)\b/i,
      /\bnpm\s+uninstall\s+[^\n|;]*-g\b/i,
      /\bpip3?\s+uninstall\b/i,
      /\bgem\s+uninstall\b/i,
    ],
  },
  {
    category: "network-exfiltration",
    risk: "medium",
    description: "Outbound data transfer via POST or netcat",
    patterns: [
      /\bcurl\b[^\n|;]*-X\s*POST\b/i,
      /\bcurl\b[^\n|;]*--data\b/i,
      /\bwget\s+--post/i,
      /\|\s*(nc|netcat|ncat)\b/i,
    ],
  },
  {
    category: "git-destructive",
    risk: "medium",
    description: "Destructive git operations (force push, hard reset, clean)",
    patterns: [
      /\bgit\s+push\b[^\n|;&]*--force\b/i,
      /\bgit\s+push\b[^\n|;&]*\s-f\b/i,
      /\bgit\s+reset\s+--hard\b/i,
      /\bgit\s+clean\b[^\n|;&]*\s-[a-zA-Z]*f[a-zA-Z]*\b/i,
    ],
  },
  {
    category: "kill-process",
    risk: "medium",
    description: "Forceful process termination",
    patterns: [/\bkill\s+-9\b/i, /\bkill\s+-s\s*(KILL|SIGKILL|9)\b/i, /\bkillall\b/i, /\bpkill\b/i],
  },
  {
    category: "docker-destructive",
    risk: "medium",
    description: "Destructive Docker operations (prune, force remove)",
    patterns: [
      /\bdocker\s+system\s+prune\b/i,
      /\bdocker\s+rm\b[^\n|;&]*\s-f\b/i,
      /\bdocker\s+rmi\b/i,
      /\bdocker\s+volume\s+rm\b/i,
    ],
  },
  {
    category: "credential-exposure",
    risk: "medium",
    description: "Reading or piping sensitive credential files",
    patterns: [
      /\bcat\b[^\n|;]*~?\/?\.ssh\/id_/i,
      /\bcat\b[^\n|;]*~?\/?\.aws\/credentials/i,
      /\bcat\b[^\n|;]*~?\/?\.gnupg\//i,
      /\bcat\b[^\n|;]*~?\/?\.netrc/i,
    ],
  },
  {
    category: "sensitive-path-write",
    risk: "medium",
    description: "Writing to sensitive dotfile directories",
    patterns: [/>\s*~?\/?\.ssh\//i, />\s*~?\/?\.gnupg\//i, /\btee\b[^\n|;]*~?\/?\.ssh\//i],
  },
];

/**
 * Classify a bash command against all danger patterns.
 * Returns all matching categories (a command can trigger multiple).
 */
export function classify(rawCommand: string): DangerMatch[] {
  if (SAFE_PATTERNS.some((p) => p.test(rawCommand))) return [];

  const command = stripHeredocs(rawCommand);
  const matches: DangerMatch[] = [];
  const seen = new Set<string>();

  for (const rule of rules) {
    for (const pattern of rule.patterns) {
      if (pattern.test(command) && !seen.has(rule.category)) {
        seen.add(rule.category);
        matches.push({
          category: rule.category,
          risk: rule.risk,
          description: rule.description,
          matched: pattern.source,
        });
        break; // one match per category is enough
      }
    }
  }

  // Sort: high risk first
  return matches.sort((a, b) => (a.risk === "high" && b.risk !== "high" ? -1 : 0));
}

/** Human-readable risk badge. */
export function riskBadge(risk: Risk): string {
  return risk === "high" ? "🔴 HIGH" : "🟡 MEDIUM";
}
