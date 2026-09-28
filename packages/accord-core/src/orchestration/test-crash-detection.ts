/**
 * Heuristic detector for a crashed (not merely failing) test-runner process.
 *
 * `red_confirmed` / `test_output` on phase-test (and `verify_output` on phase-verify-task)
 * packets are self-reported prose from the subagent that ran the tests. A test suite that
 * throws an *uncaught* exception (an unmocked side effect starting a real server, an unhandled
 * promise rejection, an OOM, a segfault, …) kills the whole runner process before it ever prints
 * a normal pass/fail summary. A subagent can still report `red_confirmed: true` with the crash
 * trace pasted in as `test_output` — that is not a valid RED signal; it is "we don't actually
 * know if the tests fail for the right reason, because the process died." Left unguarded, that
 * false-positive RED can get treated as normal signal and keep the phase-test ↔ review-test
 * loop cycling on a suite that never successfully finished running (see CLD-4639 postmortem:
 * the loop appeared "stuck" partly because of this).
 *
 * This module only pattern-matches on `test_output` text; it does not execute anything.
 */

export interface TestRunnerCrashSignal {
  /** Human-readable reason, safe to surface directly in orchestration footers/events. */
  reason: string;
  /** The substring that matched, truncated for logging/audit. */
  matched: string;
}

interface CrashSignature {
  pattern: RegExp;
  reason: string;
}

/**
 * Ordered so more specific signatures (own reason text) are tried before the generic
 * "Node.js vX.Y.Z" crash-banner fallback, which is intentionally broad.
 */
const CRASH_SIGNATURES: readonly CrashSignature[] = [
  {
    pattern: /triggerUncaughtException/,
    reason: "an uncaught exception terminated the runner process before tests could complete",
  },
  {
    pattern: /Unhandled\s+'error'\s+event|UnhandledPromiseRejection(Warning)?/i,
    reason: "an unhandled promise rejection / error event terminated the runner process",
  },
  {
    pattern: /\bEADDRINUSE\b/,
    reason:
      "a real network listener tried to bind during tests (EADDRINUSE) — likely an unmocked " +
      "service starting for real and crashing the runner",
  },
  {
    pattern: /FATAL ERROR:.*(Allocation failed|out of memory)/i,
    reason: "the runner process ran out of memory (V8 FATAL ERROR) before tests could complete",
  },
  {
    pattern: /Segmentation fault|SIGSEGV|SIGABRT/i,
    reason: "the runner process crashed with a segmentation fault / abort signal",
  },
  {
    pattern: /A jest worker process \(pid=\d+\) was terminated/i,
    reason: "a Jest worker process was terminated mid-run",
  },
  {
    pattern: /Jest worker encountered \d+ child process exceptions/i,
    reason: "Jest workers crashed with child process exceptions",
  },
  {
    pattern: /panic:.*\n\s*goroutine \d+ \[running\]/,
    reason: "an unrecovered Go panic crashed the test binary",
  },
  {
    pattern: /core dumped/i,
    reason: "the runner process aborted and dumped core",
  },
  {
    // Node's uncaught-exception crash banner: printed once, at process exit, only when an
    // uncaught error/unhandled rejection took the process down — never as part of a normal
    // (even fully failing) test summary. Kept last as the generic catch-all.
    pattern: /^Node\.js v\d+\.\d+\.\d+\s*$/m,
    reason: "the Node.js process exited via its uncaught-exception crash path, not a normal run",
  },
];

/**
 * Scans self-reported `test_output` for signatures of a crashed (not merely failing) test run.
 * Returns `null` when no crash signature is found — this is a heuristic allow-through, not proof
 * the run was clean.
 */
export function detectTestRunnerCrash(
  testOutput: string | undefined,
): TestRunnerCrashSignal | null {
  if (typeof testOutput !== "string" || testOutput.trim().length === 0) {
    return null;
  }
  for (const { pattern, reason } of CRASH_SIGNATURES) {
    const match = pattern.exec(testOutput);
    if (match) {
      const matched = match[0].slice(0, 200);
      return { reason, matched };
    }
  }
  return null;
}
