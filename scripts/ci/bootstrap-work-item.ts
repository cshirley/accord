/**
 * AC-5 / AC-6: bootstrap an ACCORD work item by calling `devBootstrap`
 * directly via TypeScript import — NO `pi` subprocess, NO MCP sidecar, NO
 * SDK in-process runtime. The AC-6 architectural rule is enforced by
 * `tests/ci/no-extra-pi-spawns.test.ts`, which also scans for SDK imports.
 *
 * For consumer repos this script imports from `@clive.shirley/pi-accord/src/core/...`
 * once published; in-tree we import via relative paths.
 *
 * Idempotency: if `.tasks/<ticket>.json` already exists we trust it (the
 * resume path is owned by `decide-resume.ts` in task 6); this function
 * exits without overwriting prior progress.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

import { devBootstrap, devTransition } from "../../src/core/work-items/lifecycle.js";
import type { JiraIssue } from "./gate-ticket.js";

export interface BootstrapOpts {
  readonly ticket: JiraIssue;
  readonly briefPath: string;
  /**
   * Optional override for the intent contract — defaults match the
   * autopipeline invariants (pipeline mode, high confidence, pipeline_allowed
   * ceiling, target_paths from the ticket's "## Target paths" section).
   */
  readonly intent?: {
    target_paths?: readonly string[];
    out_of_scope?: readonly string[];
    expected_finish?: string;
  };
}

export interface BootstrapResult {
  readonly taskStatePath: string;
}

function extractTargetPaths(description: string): string[] {
  const headingRe = /^##\s+(target paths|paths|areas?|target area)\s*$/im;
  const match = headingRe.exec(description);
  if (!match) return [];
  const after = description.slice(match.index + match[0].length);
  const nextHeading = /\n##\s+/.exec(after);
  const section = nextHeading ? after.slice(0, nextHeading.index) : after;
  return Array.from(section.matchAll(/^[-*]\s+`?([^`\n]+?)`?\s*$/gm)).map((m) => m[1]!.trim());
}

function extractOutOfScope(description: string): string[] {
  const headingRe = /^##\s+out of scope\s*$/im;
  const match = headingRe.exec(description);
  if (!match) return [];
  const after = description.slice(match.index + match[0].length);
  const nextHeading = /\n##\s+/.exec(after);
  const section = nextHeading ? after.slice(0, nextHeading.index) : after;
  return Array.from(section.matchAll(/^[-*]\s+(.+)$/gm)).map((m) => m[1]!.trim());
}

export async function bootstrapWorkItem(opts: BootstrapOpts): Promise<BootstrapResult> {
  const taskStatePath = join(".tasks", `${opts.ticket.key}.json`);

  if (existsSync(taskStatePath)) {
    // Resume path: trust the prior state. decide-resume.ts (task 6) owns
    // the decision of whether to start fresh or continue.
    return { taskStatePath };
  }

  const intent = {
    intent_mode: "pipeline" as const,
    intent_confidence: "high" as const,
    escalation_ceiling: "pipeline_allowed",
    target_paths: opts.intent?.target_paths?.slice() ?? extractTargetPaths(opts.ticket.fields.description),
    out_of_scope: opts.intent?.out_of_scope?.slice() ?? extractOutOfScope(opts.ticket.fields.description),
    expected_finish:
      opts.intent?.expected_finish ??
      `Implement ${opts.ticket.key} acceptance criteria and land a single PR.`,
  };

  devBootstrap(
    opts.ticket.key,
    opts.ticket.fields.summary,
    "implement",
    "standard",
    intent,
  );

  // For implement/standard, ENTRY_PHASES points to "aligning"; the
  // autopipeline seeds the brief and skips align, so we transition forward to
  // "speccing" immediately and attach the brief path.
  const result = devTransition(opts.ticket.key, "speccing", { brief: opts.briefPath });
  if ("error" in result) {
    throw new Error(`bootstrap transition failed: ${result.error}`);
  }

  return { taskStatePath };
}
