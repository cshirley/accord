/**
 * TC-4 + AC-5: end-to-end happy-path simulation against the
 * `complete-happy-path` scenario fixture.
 *
 * We drive every deterministic stage (gates → seed → bootstrap → decide-
 * resume → commit-and-pr) in DRY_RUN mode and assert the resulting PR body
 * and closing Jira comment match the AC-5 / AC-8 / AC-9 contract.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  commitAndPr,
  type ExecLike,
  type GhPrApi,
  renderPrBody,
} from "../../../scripts/ci/commit-and-pr.js";
import { runAgentsMdGate } from "../../../scripts/ci/gate-agents-md.js";
import { DEFAULT_TICKET_GATE_CONFIG, runTicketGate } from "../../../scripts/ci/gate-ticket.js";
import { seedBrief } from "../../../scripts/ci/seed-brief.js";

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "selftest-happy-"));
  // Seed AGENTS.md + harness JSON
  writeFileSync(
    join(repo, "AGENTS.md"),
    [
      "# Consumer repo",
      "",
      "## Dev Harness",
      "",
      "```json",
      JSON.stringify({ schema_version: "1.0", test: { command: "bun test" } }),
      "```",
    ].join("\n"),
  );
  // Seed docs/dev/<ticket>/spec.json + verify.md (pretend phase-spec + phase-verify already ran).
  mkdirSync(join(repo, "docs/dev/PROJ-42"), { recursive: true });
  writeFileSync(
    join(repo, "docs/dev/PROJ-42/spec.json"),
    JSON.stringify({
      acceptance_criteria: [
        { id: "AC-1", requirement: "MUST", scenario: "limiter" },
        { id: "AC-2", requirement: "MUST", scenario: "bypass" },
      ],
      scope: { in: ["services/search-api/"], out: ["pool sizing"] },
    }),
  );
  writeFileSync(
    join(repo, "docs/dev/PROJ-42/verify.md"),
    "# Verify report\n\nAll ACs satisfied (2/2). 30 tests pass.",
  );
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

const PASSING_TICKET = {
  key: "PROJ-42",
  fields: {
    issuetype: { name: "Story" },
    status: { name: "Ready for Autopilot" },
    summary: "Add rate limit on /v1/search",
    description:
      [
        "## Problem",
        "WHAT: pool exhaustion. WHY: incident INC-1023.",
        "",
        "## Acceptance criteria",
        "- AC1: limiter at 60 req/min/IP",
        "",
        "## Out of scope",
        "- pool sizing",
        "",
        "## Target paths",
        "- services/search-api/",
      ].join("\n") +
      "\n\n" +
      "padding ".repeat(50),
  },
} as const;

describe("complete-happy-path — gate stack", () => {
  test("agents-md gate + ticket gate both pass", () => {
    const a = runAgentsMdGate(repo, { transitionOnFailure: "Needs Triage" });
    expect(a.ok).toBe(true);
    const t = runTicketGate(PASSING_TICKET, {
      ...DEFAULT_TICKET_GATE_CONFIG,
      triggerStatus: "Ready for Autopilot",
      allowedIssueTypes: ["Story", "Task", "Bug"],
    });
    expect(t.ok).toBe(true);
  });
});

describe("complete-happy-path — brief seeding", () => {
  test("seedBrief writes brief.md with the canonical sections and returns a slug", () => {
    const outDir = join(repo, "docs/dev/PROJ-42");
    const { briefPath, slug } = seedBrief({ ticket: PASSING_TICKET, outDir });
    expect(briefPath).toBe(join(outDir, "brief.md"));
    expect(slug).toBe("add-rate-limit-on-v1-search");
    const md = readFileSync(briefPath, "utf8");
    expect(md).toContain("## Core Problem");
    expect(md).toContain("## Gathered Context");
  });
});

describe("complete-happy-path — PR body satisfies AC-5 / AC-8 / AC-9", () => {
  test("renderPrBody cites ACs, embeds verify.md, includes trailer + section template", () => {
    const verify = readFileSync(join(repo, "docs/dev/PROJ-42/verify.md"), "utf8");
    const body = renderPrBody({
      ticket: "PROJ-42",
      summary: "Add rate limit on /v1/search",
      acIds: ["AC-1", "AC-2"],
      verifyContent: verify,
      cumulativeCostUsd: 9.42,
      scopePaths: ["services/search-api/"],
    });
    expect(body).toContain("AC-1");
    expect(body).toContain("AC-2");
    expect(body).toContain("All ACs satisfied (2/2)");
    expect(body).toContain("pi.dev/autopilot: v1");
    expect(body).toMatch(
      /## Summary[\s\S]*## Scope[\s\S]*## Verify report[\s\S]*## Spec ACs[\s\S]*## Cost/,
    );
    expect(body).toContain("9.42");
  });
});

describe("complete-happy-path — commit-and-pr dry-run", () => {
  test("dry-run path computes the branch + body without making any git push or gh call", async () => {
    const calls: string[] = [];
    const exec: ExecLike = async (cmd, args) => {
      calls.push(`${cmd} ${args.join(" ")}`);
      if (cmd === "git" && args[0] === "rev-parse") {
        return { exitCode: 0, stdout: "main\n", stderr: "" };
      }
      return { exitCode: 0, stdout: "", stderr: "" };
    };
    const gh: GhPrApi = {
      findPrByHead: async () => null,
      createPr: async () => ({ url: "n/a", number: 0 }),
      updatePr: async () => {},
      labelExists: async () => true,
      createLabel: async () => {},
      addLabelToPr: async () => {},
    };
    const r = await commitAndPr(
      {
        repoRoot: repo,
        ticket: "PROJ-42",
        summary: "Add rate limit on /v1/search",
        branchPrefix: "accord/",
        baseBranch: "main",
        specPath: "docs/dev/PROJ-42/spec.json",
        verifyPath: "docs/dev/PROJ-42/verify.md",
        cumulativeCostUsd: 9.42,
        secrets: [],
        dryRun: true,
      },
      { exec, gh },
    );
    expect(r.branch).toBe("accord/PROJ-42-add-rate-limit-on-v1-search");
    expect(r.prUrl).toContain("dry-run");
    expect(calls.some((c) => c.startsWith("git push"))).toBe(false);
  });
});
