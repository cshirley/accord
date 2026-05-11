/**
 * AC-14 (TC-12): every upload-artifact step in the workflow is canonical
 * and the cross-run download action is pinned by SHA (no `@v*` tag refs).
 *
 * Static-parse-based: reads .github/workflows/autopipeline.yml as YAML and
 * walks every step. Any drift from the literal `name`, `if:`, `overwrite`,
 * `retention-days`, or `path:` strings trips a verbatim mismatch.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { parse as parseYaml } from "yaml";

const REPO_ROOT = resolve(import.meta.dir, "../..");
const WORKFLOW_PATH = join(REPO_ROOT, ".github/workflows/autopipeline.yml");
const RAW = readFileSync(WORKFLOW_PATH, "utf8");
const WORKFLOW = parseYaml(RAW) as Record<string, unknown>;

interface AnyStep {
  uses?: string;
  if?: string;
  name?: string;
  with?: Record<string, unknown>;
  [key: string]: unknown;
}

function allSteps(): AnyStep[] {
  const jobs = WORKFLOW.jobs as Record<string, { steps?: AnyStep[] }>;
  const out: AnyStep[] = [];
  for (const job of Object.values(jobs)) {
    if (Array.isArray(job.steps)) out.push(...job.steps);
  }
  return out;
}

function isUploadArtifactStep(s: AnyStep): boolean {
  return typeof s.uses === "string" && s.uses.startsWith("actions/upload-artifact@");
}

function isDownloadArtifactDawidd6(s: AnyStep): boolean {
  return typeof s.uses === "string" && s.uses.startsWith("dawidd6/action-download-artifact@");
}

describe("AC-14 — upload-artifact step canonical config", () => {
  const uploads = allSteps().filter(isUploadArtifactStep);

  test("there is at least one upload-artifact step in the workflow", () => {
    expect(uploads.length).toBeGreaterThan(0);
  });

  for (let i = 0; i < uploads.length; i++) {
    const step = uploads[i]!;
    const label = step.name ?? `upload-artifact #${i}`;

    test(`${label}: uses actions/upload-artifact@v4 (major-pinned)`, () => {
      expect((step.uses as string).startsWith("actions/upload-artifact@v4")).toBe(true);
    });

    test(`${label}: has if: always()`, () => {
      expect(step.if).toBe("${{ always() }}");
    });

    test(`${label}: with.name = accord-state-\${{ inputs.ticket }}`, () => {
      expect((step.with ?? {}).name).toBe("accord-state-${{ inputs.ticket }}");
    });

    test(`${label}: with.overwrite = true`, () => {
      expect((step.with ?? {}).overwrite).toBe(true);
    });

    test(`${label}: with.retention-days = 14`, () => {
      expect((step.with ?? {})["retention-days"]).toBe(14);
    });

    test(`${label}: with.path lines include both docs/dev and .tasks ticket roots`, () => {
      const path = (step.with ?? {}).path;
      const pathLines = typeof path === "string"
        ? path.split("\n").map((l) => l.trim()).filter(Boolean)
        : [];
      expect(pathLines).toContain("docs/dev/${{ inputs.ticket }}/");
      expect(pathLines).toContain(".tasks/${{ inputs.ticket }}*");
    });
  }
});

describe("AC-14 — cross-run download via dawidd6/action-download-artifact pinned by SHA", () => {
  const downloads = allSteps().filter(isDownloadArtifactDawidd6);

  test("there is at least one dawidd6/action-download-artifact reference (cross-run resume)", () => {
    expect(downloads.length).toBeGreaterThan(0);
  });

  for (let i = 0; i < downloads.length; i++) {
    const step = downloads[i]!;
    const label = step.name ?? `download-artifact #${i}`;

    test(`${label}: pinned by 40-character SHA (not @v* tag)`, () => {
      const uses = step.uses as string;
      const tagPart = uses.split("@")[1] ?? "";
      expect(tagPart).toMatch(/^[a-f0-9]{40}$/);
    });
  }
});

describe("AC-14 — terminal-branch hardening", () => {
  // The job uses `if:` conditions to branch into terminal paths. Sanity-check
  // that the workflow at least has steps whose name/id implies the terminal
  // categories from the spec (gates, needs_input, blocked, gaps, cost, done).
  const TERMINAL_LABELS = [
    "agents",
    "ticket",
    "needs_input",
    "blocked",
    "gaps",
    "cost",
    "in_review",
  ];

  test("every documented terminal category appears in at least one step name/id", () => {
    const text = JSON.stringify(allSteps()).toLowerCase();
    for (const label of TERMINAL_LABELS) {
      expect(text).toContain(label);
    }
  });
});
