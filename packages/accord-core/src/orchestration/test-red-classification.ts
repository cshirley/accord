/**
 * Heuristic detector for **import / resolution RED** in phase-test `test_output`.
 *
 * A pre-impl suite that fails because the runner cannot resolve the module or symbol under test
 * (`Cannot find module`, `Export named 'x' not found`, `ModuleNotFoundError`, `undefined: Foo`,
 * …) is red for the wrong reason: no assertion executed, so `review-test` has nothing to attack
 * and will (correctly) flag Check 0 as critical. Historically that finding was routed back to
 * phase-test with a recommendation phase-test was not allowed to act on, so the
 * phase-test ↔ review-test loop burned retries without converging.
 *
 * The harness now classifies this deterministically in the phase-test post-result handler and
 * bounces straight back to phase-test with a concrete "declare these unimplemented stubs"
 * finding — without spending a review-test spawn on a suite that never ran.
 *
 * This module only pattern-matches on text; it does not execute anything.
 */

export interface ImportOnlyRedSignal {
  /** Human-readable reason, safe to surface directly in orchestration footers/events. */
  reason: string;
  /** Unresolved module paths / symbol names extracted from the output (deduped, capped). */
  missing: string[];
  /** Matched output lines (truncated) for evidence. */
  matched: string[];
}

interface ResolutionSignature {
  pattern: RegExp;
  /** Capture group index holding the missing module/symbol, when the signature has one. */
  group?: number;
}

/** Global regexes — iterated with `matchAll`, so every occurrence contributes a missing name. */
const RESOLUTION_SIGNATURES: readonly ResolutionSignature[] = [
  // Node / Bun / Jest / tsc TS2307
  { pattern: /Cannot find module ['"`]([^'"`]+)['"`]/g, group: 1 },
  // Vite / Vitest
  { pattern: /Failed to resolve import ['"`]([^'"`]+)['"`]/g, group: 1 },
  { pattern: /Failed to load url ([^\s]+)/g, group: 1 },
  // Webpack
  { pattern: /Module not found: (?:Error: )?Can't resolve ['"`]([^'"`]+)['"`]/g, group: 1 },
  { pattern: /\bERR_MODULE_NOT_FOUND\b/g },
  { pattern: /\bMODULE_NOT_FOUND\b/g },
  // Bun / Node ESM missing named export
  { pattern: /Export named ['"`]([^'"`]+)['"`] not found in module/g, group: 1 },
  { pattern: /does not provide an export named ['"`]([^'"`]+)['"`]/g, group: 1 },
  // TypeScript missing export
  {
    pattern: /TS2305: Module ['"`][^'"`]+['"`] has no exported member ['"`]([^'"`]+)['"`]/g,
    group: 1,
  },
  {
    pattern: /TS2614: Module ['"`][^'"`]+['"`] has no exported member ['"`]([^'"`]+)['"`]/g,
    group: 1,
  },
  // Python
  { pattern: /ModuleNotFoundError: No module named ['"`]([^'"`]+)['"`]/g, group: 1 },
  { pattern: /ImportError: cannot import name ['"`]([^'"`]+)['"`]/g, group: 1 },
  // Go (compile failure of the test binary)
  { pattern: /^\S+\.go:\d+:\d+: undefined: ([A-Za-z_][\w.]*)/gm, group: 1 },
  { pattern: /cannot find package ['"`]([^'"`]+)['"`]/g, group: 1 },
  // Rust
  { pattern: /error\[E0432\]: unresolved import `([^`]+)`/g, group: 1 },
  { pattern: /error\[E0425\]: cannot find (?:function|value) `([^`]+)`/g, group: 1 },
  // Java / Kotlin
  { pattern: /error: cannot find symbol\s*\n\s*symbol:\s*\w+\s+(\S+)/g, group: 1 },
];

const MAX_MISSING = 10;
const MAX_MATCHED = 5;

function lineContaining(text: string, index: number): string {
  const start = text.lastIndexOf("\n", index) + 1;
  const endRaw = text.indexOf("\n", index);
  const end = endRaw === -1 ? text.length : endRaw;
  return text.slice(start, end).trim().slice(0, 200);
}

/**
 * Scans self-reported `test_output` for unresolved-module / missing-symbol signatures.
 * Returns `null` when none are found — a heuristic allow-through, not proof of behaviour RED.
 */
export function detectImportOnlyRed(testOutput: string | undefined): ImportOnlyRedSignal | null {
  if (typeof testOutput !== "string" || testOutput.trim().length === 0) {
    return null;
  }
  const missing: string[] = [];
  const matched: string[] = [];
  for (const { pattern, group } of RESOLUTION_SIGNATURES) {
    for (const match of testOutput.matchAll(pattern)) {
      const line = lineContaining(testOutput, match.index ?? 0);
      if (matched.length < MAX_MATCHED && !matched.includes(line)) {
        matched.push(line);
      }
      const name = group !== undefined ? match[group]?.trim() : undefined;
      if (name && missing.length < MAX_MISSING && !missing.includes(name)) {
        missing.push(name);
      }
    }
  }
  if (matched.length === 0) {
    return null;
  }
  const names = missing.length > 0 ? ` (${missing.map((m) => `\`${m}\``).join(", ")})` : "";
  return {
    reason: `test run failed on module/symbol resolution${names} — no assertion executed against the system under test`,
    missing,
    matched,
  };
}
