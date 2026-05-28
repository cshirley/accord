/**
 * Help text for /dev help — generated from DEV_SUBCOMMANDS.
 */

import { DEV_SUBCOMMANDS } from "./dispatch.js";

function buildHelpText(): string {
  const maxLen = Math.max(...DEV_SUBCOMMANDS.map((s) => s.value.length));
  const subLines = DEV_SUBCOMMANDS.map(
    (s) => `  ${s.value.padEnd(maxLen + 4)}${s.description}`,
  ).join("\n");

  return `/dev — agentic harness entry point

Routing (deterministic):
  Local in extension: help, tasks, retro, tag, rehydrate, init, spec-gaps, review, gaps, deviations.
  Core orchestrator (default): resume, finish, align, spec, plan, check, amend-spec.
  gaps --tickets / deviations review spawn phase agents when orchestrator is enabled.
  Set ACCORD_CORE_ORCHESTRATOR=0 to disable programmatic spawns (not recommended; bundled accord skill removed).
  Free text: core runs intent rules as dev_intent (and may bootstrap a ticket-shaped work item), then resumes when an ID is present; otherwise continues in this session with dev_* tools.

Standard flow:
  /dev init
      ↓
  /dev <description>
      ↓
  /dev align <ID> → /dev spec <ID> → /dev plan <ID>
      ↓
  /dev resume <ID>
      ↓
  /dev finish <ID>
      ├─ COMPLETE → /commit → /pr
      ├─ GAPS → /dev gaps <ID>
      ├─ NEEDS_DECISION → /dev review
      └─ BLOCKED → /dev resume <ID>

Optional: /dev check <ID> reruns lower-level acceptance checks.

Subcommands:
${subLines}
  <free text>             Classify pattern, bootstrap work item, dispatch

Examples:
  /dev                              list active work or show this help
  /dev init                         configure harness for this project
 /dev ACCORD-1234 add refresh tokens start a new implement/standard work item
 /dev align ACCORD-1234            collaborative problem framing
 /dev spec ACCORD-1234             resume the spec interview
 /dev plan ACCORD-1234             generate the implementation plan
 /dev resume ACCORD-1234           continue at the work item's phase
 /dev finish ACCORD-1234           verify, summarize, and finalize after implementation
 /dev check ACCORD-1234            rerun lower-level acceptance checks
 /dev gaps ACCORD-1234             list verify gaps (add --tickets for Jira follow-ups)
 /dev deviations ACCORD-1234       list pending plan deviations (accept|revert|review)

State lives in .tasks/ (runtime) and docs/dev/<ID>/ (committed).
Safe to /clear between rounds — resume with /dev resume <ID>.`;
}

export const DEV_HELP_TEXT = buildHelpText();
