/**
 * Brief-level "lens" for PR reviews: extra guidance appended to each reviewer's task brief.
 *
 * It lives in the brief, not in the agent files, on purpose. `review-code`, `review-security` and
 * `review-test` are shared with the ACCORD harness, whose briefs always carry a spec and plan and
 * whose findings `phase-code` must answer. A standalone or PR brief carries neither, so this text
 * only ever reaches reviews that have no harness behind them. Once a lens is shown to help it can
 * be promoted into each agent's own "Standalone mode" section.
 */

/** The standalone return packet, stated outright: the agents otherwise point at a harness-injected schema. */
export const PR_RETURN_SHAPE = `## Return packet (this review has no harness schema)
End with exactly one fenced \`\`\`json block:
{"verdict":"clean"|"issues","files_reviewed":["<path>",...],"findings":[{"severity":"critical"|"warning"|"suggestion","file":"<path>","line":<head-side line number>,"issue":"<one sentence>","evidence":"<what you saw; for a critical, the input, the path and the wrong result>","recommendation":"<concrete fix>","category":"<see your lens>"}]}
\`file\` is the repository-relative path and \`line\` a line in the head version of the file. A finding with no file and line cannot be posted as a comment, so cite both whenever you can. \`files_reviewed\` lists the changed files you actually read.`;

const CODE_LENS = `## Review lens (applies to this PR review only)
- A comment, JSDoc, README line or file-header contract that says one thing while the code under it does another is a **warning**, not a taste item. Quote both. Check that things a header claims exist (a parity test, a script, a referenced file) really do.
- A crash, unhandled rejection, data loss or wrong result you can trigger with a stated input is **critical**: give the input, the path and the wrong result in \`evidence\`.
- Return every distinct root cause. Do not stop at ~15 findings and do not shorten the report: the "cap" and "keep it short" rules belong to the harness loop. Merge findings that are one root cause, and put the strongest first.
- Read each changed file in full and follow its callers and callees in the checkout; the diff alone hides mismatches.
- Use \`category\`: correctness, reliability, compatibility, consistency, docs, performance or observability.`;

const SECURITY_LENS = `## STRIDE lens (applies to this PR review only; use it instead of walking the OWASP table)
**Step 1, model what the diff adds or changes.** From the diff and the checkout list: the assets (credentials, tokens, personal or clinical data, the availability of shared services, integrity guarantees such as "each call runs once"); the entry points (HTTP handlers, CLI commands, message consumers, anything reachable from another pod or service) and who can reach each one before authenticating; the trust boundaries and the data that crosses them; and the assumptions the code or its comments state ("only reachable in-cluster", "the verifier checks X first").
**Step 2, ask STRIDE of each entry point, boundary and flow.**
- **S**poofing: can a caller pass as another identity, role, pod or environment? Are proofs and tokens bound to the exact call, audience and time?
- **T**ampering: can data, config, signatures or stored state be changed undetected? Is a check run on what is later used, or on something else?
- **R**epudiation: can an action happen with no durable, attributable record, or a record the actor can alter or suppress?
- **I**nformation disclosure: do logs, errors, status or manifest endpoints, URLs, or digests reveal secrets, identities, topology or personal data?
- **D**enial of service: can an unauthenticated or low-privilege caller crash the process, exhaust a shared counter, memory, sockets or a downstream quota, or hold work open?
- **E**levation of privilege: can a caller reach an operation, role, data class or environment it is not entitled to, or can a check fail open?
**Step 3, test each stated assumption.** Verify the code enforces it, and say so when it does not.
**Severity for this review.** \`critical\`: a concrete trigger reachable by an unauthenticated or lower-privileged actor that breaks a security guarantee or takes down a shared service; give the input, the path and the effect. \`warning\`: the same weakness without a demonstrated trigger, or a hardening gap that must be fixed before general availability. \`suggestion\`: defence in depth. Availability counts: do not rank a pre-authentication crash below a warning because it is not data theft.
**Category.** Use the STRIDE letter or letters (S, T, R, I, D, E) and name the OWASP id in \`issue\` as a secondary tag. Report only security-relevant issues.`;

const TEST_LENS = `## Review lens (applies to this PR review only)
There is no spec, so there are no acceptance criteria to attack. Instead, for each behaviour the changed tests claim to cover, devise the simplest wrong implementation that would still pass them, and report the ones a competent developer could write by accident.
- Run Checks 1b, 2, 4, 5, 6, 8 and 9. Skip Check 0 (not a pre-implementation review) and Checks 1, 3, 3b and 7 (they need acceptance criteria).
- If \`test_output\` is "(not run)", read the tests and do not downgrade the verdict for that alone; say that the suite was not run.
- Use \`category\`: adversarial, assertion, fixture or side-effect.`;

export const PR_REVIEW_LENS: Readonly<Record<string, string>> = {
  "review-code": CODE_LENS,
  "review-security": SECURITY_LENS,
  "review-test": TEST_LENS,
};

/** The lens for `agent` plus the return shape, or an empty string for an agent with no lens. */
export function prReviewLensFor(agent: string): string {
  const lens = PR_REVIEW_LENS[agent];
  return lens === undefined ? "" : `\n\n${lens}\n\n${PR_RETURN_SHAPE}`;
}
