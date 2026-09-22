/**
 * AC-8 / AC-9 / AC-11: branch + commit + force-with-lease push + idempotent
 * PR upsert with the autopilot label and secret-scrubbed body.
 *
 * The shell-out surface (`git`) and GitHub API surface (`gh` / REST) are
 * dependency-injected so the test harness can drive both without spawning
 * real subprocesses. Production callers use the defaults at module bottom.
 *
 * Branch naming (AC-11): `<branchPrefix><ticket>-<slug>`. The slug comes
 * from `seed-brief.slugify` (task 4) so it is stable across runs and
 * deterministic from the ticket summary.
 *
 * PR body (AC-8): rendered by `renderPrBody` (exported separately so unit
 * tests can pin the section template). Pre-publish scrub: if any value in
 * `opts.secrets` appears in the rendered body the function throws — the
 * workflow falls back to the generic "stuck — secret leak" terminal.
 */

import { readFileSync } from "node:fs";
import { join, relative } from "node:path";

import { slugify } from "./seed-brief.js";

export interface CommitAndPrOpts {
  readonly repoRoot: string;
  readonly ticket: string;
  readonly summary: string;
  readonly branchPrefix: string;
  readonly baseBranch: string;
  readonly specPath: string;
  readonly verifyPath: string;
  readonly cumulativeCostUsd: number;
  readonly secrets: readonly string[];
  readonly dryRun: boolean;
}

export interface ExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type ExecLike = (
  cmd: string,
  args: readonly string[],
  opts?: { cwd?: string },
) => Promise<ExecResult>;

export interface PrInfo {
  readonly url: string;
  readonly number: number;
}

export interface GhPrApi {
  findPrByHead(payload: { head: string; base: string }): Promise<PrInfo | null>;
  createPr(payload: {
    head: string;
    base: string;
    title: string;
    body: string;
    draft: boolean;
  }): Promise<PrInfo>;
  updatePr(payload: { number: number; body: string }): Promise<void>;
  labelExists(payload: { name: string }): Promise<boolean>;
  createLabel(payload: { name: string; color: string; description: string }): Promise<void>;
  addLabelToPr(payload: { number: number; name: string }): Promise<void>;
}

export interface CommitAndPrInjects {
  readonly exec: ExecLike;
  readonly gh: GhPrApi;
}

export interface CommitAndPrResult {
  readonly prUrl: string;
  readonly branch: string;
}

const AUTOPILOT_LABEL = "autopilot/v1";
const AUTOPILOT_TRAILER = "pi.dev/autopilot: v1";

// ─── PR body rendering (AC-8) ────────────────────────────────

export interface RenderPrBodyOpts {
  readonly ticket: string;
  readonly summary: string;
  readonly acIds: readonly string[];
  readonly verifyContent: string;
  readonly cumulativeCostUsd: number;
  readonly scopePaths: readonly string[];
}

export function renderPrBody(opts: RenderPrBodyOpts): string {
  const acList =
    opts.acIds.length > 0 ? opts.acIds.map((id) => `- ${id}`).join("\n") : "- (no ACs cited)";
  const scopeList =
    opts.scopePaths.length > 0
      ? opts.scopePaths.map((p) => `- \`${p}\``).join("\n")
      : "- (see Spec ACs for the scope target paths)";

  return [
    `## Summary`,
    "",
    `Closes \`${opts.ticket}\`: ${opts.summary}`,
    "",
    `## Scope`,
    "",
    scopeList,
    "",
    `## Verify report`,
    "",
    "```",
    opts.verifyContent.trim(),
    "```",
    "",
    `## Spec ACs`,
    "",
    acList,
    "",
    `## Cost`,
    "",
    `Cumulative subagent cost for this PR: **$${opts.cumulativeCostUsd}**.`,
    "",
    `---`,
    "",
    AUTOPILOT_TRAILER,
    "",
  ].join("\n");
}

interface AcceptanceCriterion {
  readonly id: string;
  readonly [key: string]: unknown;
}

interface SpecJson {
  readonly acceptance_criteria?: readonly AcceptanceCriterion[];
  readonly scope?: { readonly in?: readonly string[]; readonly out?: readonly string[] };
}

function loadAcIds(repoRoot: string, specPath: string): string[] {
  const fullPath = join(repoRoot, specPath);
  try {
    const spec = JSON.parse(readFileSync(fullPath, "utf8")) as SpecJson;
    return (spec.acceptance_criteria ?? []).map((ac) => ac.id);
  } catch {
    return [];
  }
}

function loadScopePaths(repoRoot: string, specPath: string): string[] {
  const fullPath = join(repoRoot, specPath);
  try {
    const spec = JSON.parse(readFileSync(fullPath, "utf8")) as SpecJson;
    return [...(spec.scope?.in ?? [])];
  } catch {
    return [];
  }
}

function loadVerifyContent(repoRoot: string, verifyPath: string): string {
  const fullPath = join(repoRoot, verifyPath);
  try {
    return readFileSync(fullPath, "utf8");
  } catch {
    return "(verify.md not found — run /dev finish first)";
  }
}

function scrubSecrets(body: string, secrets: readonly string[]): void {
  for (const s of secrets) {
    if (s.length > 0 && body.includes(s)) {
      throw new Error(
        `PR body would leak a configured secret value (length ${s.length}); aborting commit-and-pr. ` +
          "This is AC-8 defence-in-depth.",
      );
    }
  }
}

// ─── Main entry point ────────────────────────────────────────

export async function commitAndPr(
  opts: CommitAndPrOpts,
  inject: CommitAndPrInjects,
): Promise<CommitAndPrResult> {
  const { exec, gh } = inject;
  const branch = `${opts.branchPrefix}${opts.ticket}-${slugify(opts.summary)}`;
  const cwd = opts.repoRoot;

  // 1. Determine the current branch (used for restore in error paths).
  await exec("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd });

  // 2. Check out (or create) the target branch.
  await exec("git", ["checkout", "-B", branch], { cwd });

  // 3. Stage every artifact under docs/dev/<ticket>/ and any source changes.
  await exec("git", ["add", "-A"], { cwd });

  // 4. Commit. The commit skill normally drafts the message; for v1 we use
  //    a fixed message so the test surface is deterministic.
  await exec(
    "git",
    [
      "commit",
      "-m",
      `feat(${opts.ticket}): ${opts.summary}`,
      "-m",
      `Closes ${opts.ticket}.\n\n${AUTOPILOT_TRAILER}`,
      "--allow-empty",
    ],
    { cwd },
  );

  // 5. Build the PR body and pre-publish scrub.
  const acIds = loadAcIds(cwd, opts.specPath);
  const verifyContent = loadVerifyContent(cwd, opts.verifyPath);
  const scopePaths = loadScopePaths(cwd, opts.specPath);
  const body = renderPrBody({
    ticket: opts.ticket,
    summary: opts.summary,
    acIds,
    verifyContent,
    cumulativeCostUsd: opts.cumulativeCostUsd,
    scopePaths,
  });
  scrubSecrets(body, opts.secrets);

  // 6. Dry-run short-circuit BEFORE the push.
  if (opts.dryRun) {
    return { prUrl: `(dry-run — would push ${branch})`, branch };
  }

  // 7. Force-with-lease push (AC-11).
  await exec("git", ["push", "--set-upstream", "origin", branch, "--force-with-lease"], { cwd });

  // 8. Idempotent PR upsert (AC-11).
  const existing = await gh.findPrByHead({ head: branch, base: opts.baseBranch });
  let pr: PrInfo;
  if (existing) {
    await gh.updatePr({ number: existing.number, body });
    pr = existing;
  } else {
    pr = await gh.createPr({
      head: branch,
      base: opts.baseBranch,
      title: `${opts.ticket}: ${opts.summary}`,
      body,
      draft: true,
    });
  }

  // 9. Idempotent autopilot label (AC-9).
  const hasLabel = await gh.labelExists({ name: AUTOPILOT_LABEL });
  if (!hasLabel) {
    await gh.createLabel({
      name: AUTOPILOT_LABEL,
      color: "BFD4F2",
      description: "Autopilot v1 — PRs opened by the ACCORD autopipeline.",
    });
  }
  await gh.addLabelToPr({ number: pr.number, name: AUTOPILOT_LABEL });

  return { prUrl: pr.url, branch };
}

// Suppress unused-import lint until task 11 wires defaults.
void relative;
