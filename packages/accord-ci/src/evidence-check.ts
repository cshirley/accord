/**
 * accord/evidence check runner. Rules are added by later tasks; the workflow
 * `.github/workflows/accord-evidence.yml` runs this script over base..head and
 * posts the result as a commit status.
 */

import { writeFileSync } from "node:fs";
import { createContractLockRule } from "./checks/contract-lock.js";
import { createFeatureDriftRule } from "./checks/feature-drift.js";
import { createLeftoverStateRule } from "./checks/leftover-state.js";

export interface EvidenceContext {
  base: string;
  head: string;
}

export type RuleOutcome = { ok: true } | { ok: false; message: string };

export interface EvidenceRule {
  name: string;
  run(ctx: EvidenceContext): RuleOutcome | Promise<RuleOutcome>;
}

export interface EvidenceResult {
  exitCode: 0 | 1;
  lines: string[];
  failures: { rule: string; message: string }[];
}

export interface CommitStatusPayload {
  context: "accord/evidence";
  state: "success" | "failure";
  description: string;
}

const STATUS_CONTEXT = "accord/evidence";
const DESCRIPTION_LIMIT = 140;

export async function runEvidenceCheck(
  rules: readonly EvidenceRule[],
  ctx: EvidenceContext,
): Promise<EvidenceResult> {
  const failures: { rule: string; message: string }[] = [];
  for (const rule of rules) {
    try {
      const outcome = await rule.run(ctx);
      if (!outcome.ok) failures.push({ rule: rule.name, message: outcome.message });
    } catch (error) {
      failures.push({
        rule: rule.name,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return {
    exitCode: failures.length === 0 ? 0 : 1,
    lines: failures.map((failure) => `${STATUS_CONTEXT}: ${failure.rule}: ${failure.message}`),
    failures,
  };
}

export function toCommitStatus(result: EvidenceResult): CommitStatusPayload {
  const first = result.failures[0];
  if (!first) {
    return { context: STATUS_CONTEXT, state: "success", description: "Evidence checks passed" };
  }
  const extra = result.failures.length > 1 ? ` (+${result.failures.length - 1} more)` : "";
  const description = `${first.rule}: ${first.message}${extra}`;
  return {
    context: STATUS_CONTEXT,
    state: "failure",
    description:
      description.length > DESCRIPTION_LIMIT
        ? `${description.slice(0, DESCRIPTION_LIMIT - 1)}…`
        : description,
  };
}

export function evidenceRules(): readonly EvidenceRule[] {
  return [createContractLockRule(), createLeftoverStateRule(), createFeatureDriftRule()];
}

export interface MainOptions {
  argv: readonly string[];
  rules?: readonly EvidenceRule[];
  out?: (line: string) => void;
}

function flag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

export async function main(opts: MainOptions): Promise<number> {
  const out = opts.out ?? ((line: string) => console.log(line));
  const base = flag(opts.argv, "--base");
  const head = flag(opts.argv, "--head");
  if (!base || !head) {
    out(`accord/evidence: usage: ${base ? "--head" : "--base"} is required`);
    return 2;
  }
  const result = await runEvidenceCheck(opts.rules ?? evidenceRules(), { base, head });
  for (const line of result.lines) out(line);
  const statusOut = flag(opts.argv, "--status-out");
  if (statusOut) writeFileSync(statusOut, `${JSON.stringify(toCommitStatus(result))}\n`);
  return result.exitCode;
}

if (import.meta.main) {
  process.exit(await main({ argv: process.argv.slice(2) }));
}
