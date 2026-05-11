import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  commitAndPr,
  renderPrBody,
  type CommitAndPrOpts,
  type ExecLike,
  type GhPrApi,
} from "../../scripts/ci/commit-and-pr.js";

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "accord-commit-pr-"));
  mkdirSync(join(repo, "docs/dev/PROJ-1"), { recursive: true });
  writeFileSync(
    join(repo, "docs/dev/PROJ-1/spec.json"),
    JSON.stringify({
      acceptance_criteria: [
        { id: "AC-1", requirement: "MUST", scenario: "x" },
        { id: "AC-2", requirement: "MUST", criterion: "y" },
      ],
    }),
  );
  writeFileSync(
    join(repo, "docs/dev/PROJ-1/verify.md"),
    "# Verify report\n\nAll 2 ACs satisfied. 18 tests pass.",
  );
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

interface RecordedCmd {
  cmd: string;
  args: string[];
}

function makeExec(): { exec: ExecLike; recorded: RecordedCmd[] } {
  const recorded: RecordedCmd[] = [];
  const exec: ExecLike = async (cmd, args) => {
    recorded.push({ cmd, args: [...args] });
    if (cmd === "git" && args[0] === "rev-parse" && args[1] === "--abbrev-ref") {
      return { exitCode: 0, stdout: "main\n", stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  return { exec, recorded };
}

interface GhCall {
  method: keyof GhPrApi;
  payload: unknown;
}

function makeGh(
  existingPrUrl: string | null,
  labelExists: boolean = true,
): { gh: GhPrApi; calls: GhCall[]; createdLabel: boolean } {
  const calls: GhCall[] = [];
  let createdLabel = false;
  const gh: GhPrApi = {
    findPrByHead: async (payload) => {
      calls.push({ method: "findPrByHead", payload });
      return existingPrUrl ? { url: existingPrUrl, number: 42 } : null;
    },
    createPr: async (payload) => {
      calls.push({ method: "createPr", payload });
      return { url: "https://github.com/owner/repo/pull/100", number: 100 };
    },
    updatePr: async (payload) => {
      calls.push({ method: "updatePr", payload });
    },
    labelExists: async (payload) => {
      calls.push({ method: "labelExists", payload });
      return labelExists;
    },
    createLabel: async (payload) => {
      calls.push({ method: "createLabel", payload });
      createdLabel = true;
    },
    addLabelToPr: async (payload) => {
      calls.push({ method: "addLabelToPr", payload });
    },
  };
  return {
    gh,
    calls,
    get createdLabel() {
      return createdLabel;
    },
  };
}

function defaultOpts(repo: string, overrides: Partial<CommitAndPrOpts> = {}): CommitAndPrOpts {
  return {
    repoRoot: repo,
    ticket: "PROJ-1",
    summary: "Add rate limit",
    branchPrefix: "accord/",
    baseBranch: "main",
    specPath: "docs/dev/PROJ-1/spec.json",
    verifyPath: "docs/dev/PROJ-1/verify.md",
    cumulativeCostUsd: 7.5,
    secrets: [],
    dryRun: false,
    ...overrides,
  };
}

describe("renderPrBody — AC-8 / AC-9 invariants", () => {
  test("cites at least one spec AC ID", () => {
    const body = renderPrBody({
      ticket: "PROJ-1",
      summary: "Add rate limit",
      acIds: ["AC-1", "AC-2"],
      verifyContent: "All 2 ACs satisfied.",
      cumulativeCostUsd: 7.5,
      scopePaths: ["services/search-api/"],
    });
    expect(body).toMatch(/AC-1/);
  });

  test("includes a `## Verify report` section quoting verify.md", () => {
    const body = renderPrBody({
      ticket: "PROJ-1",
      summary: "Add rate limit",
      acIds: ["AC-1"],
      verifyContent: "MARKER_VERIFY_CONTENT_42",
      cumulativeCostUsd: 7.5,
      scopePaths: [],
    });
    expect(body).toContain("## Verify report");
    expect(body).toContain("MARKER_VERIFY_CONTENT_42");
  });

  test("includes the AC-9 trailer `pi.dev/autopilot: v1`", () => {
    const body = renderPrBody({
      ticket: "PROJ-1",
      summary: "Add rate limit",
      acIds: ["AC-1"],
      verifyContent: "...",
      cumulativeCostUsd: 7.5,
      scopePaths: [],
    });
    expect(body).toContain("pi.dev/autopilot: v1");
  });

  test("follows the assets/skills/pr/SKILL.md section template (Summary / Scope / Verify report / Spec ACs / Cost)", () => {
    const body = renderPrBody({
      ticket: "PROJ-1",
      summary: "Add rate limit",
      acIds: ["AC-1"],
      verifyContent: "...",
      cumulativeCostUsd: 7.5,
      scopePaths: ["foo/", "bar/"],
    });
    expect(body).toMatch(/## Summary/);
    expect(body).toMatch(/## Scope/);
    expect(body).toMatch(/## Verify report/);
    expect(body).toMatch(/## Spec ACs/);
    expect(body).toMatch(/## Cost/);
  });

  test("cumulative cost is present in `## Cost`", () => {
    const body = renderPrBody({
      ticket: "PROJ-1",
      summary: "Add rate limit",
      acIds: ["AC-1"],
      verifyContent: "...",
      cumulativeCostUsd: 7.5,
      scopePaths: [],
    });
    expect(body).toMatch(/Cost[\s\S]*7\.5/);
  });
});

describe("commitAndPr — branch naming (AC-11)", () => {
  test("branch is `<branchPrefix><ticket>-<slug>` derived from summary", async () => {
    const { exec, recorded } = makeExec();
    const { gh } = makeGh(null);
    const r = await commitAndPr(defaultOpts(repo), { exec, gh });
    expect(r.branch).toBe("accord/PROJ-1-add-rate-limit");
    // verify the branch checkout happened on the computed name
    const checkout = recorded.find((c) => c.cmd === "git" && c.args[0] === "checkout");
    expect(checkout?.args).toContain("accord/PROJ-1-add-rate-limit");
  });
});

describe("commitAndPr — push uses --force-with-lease (AC-11)", () => {
  test("git push includes --force-with-lease, never --force alone", async () => {
    const { exec, recorded } = makeExec();
    const { gh } = makeGh(null);
    await commitAndPr(defaultOpts(repo), { exec, gh });
    const pushes = recorded.filter((c) => c.cmd === "git" && c.args[0] === "push");
    expect(pushes.length).toBeGreaterThan(0);
    for (const p of pushes) {
      expect(p.args).toContain("--force-with-lease");
      expect(p.args.some((a) => a === "--force" || a === "-f")).toBe(false);
    }
  });
});

describe("commitAndPr — idempotent PR upsert (AC-11)", () => {
  test("first run with no existing PR → calls createPr", async () => {
    const { exec } = makeExec();
    const { gh, calls } = makeGh(null);
    await commitAndPr(defaultOpts(repo), { exec, gh });
    expect(calls.some((c) => c.method === "createPr")).toBe(true);
    expect(calls.some((c) => c.method === "updatePr")).toBe(false);
  });

  test("second run with an existing PR → calls updatePr, never createPr", async () => {
    const { exec } = makeExec();
    const { gh, calls } = makeGh("https://github.com/owner/repo/pull/42");
    await commitAndPr(defaultOpts(repo), { exec, gh });
    expect(calls.some((c) => c.method === "updatePr")).toBe(true);
    expect(calls.some((c) => c.method === "createPr")).toBe(false);
  });
});

describe("commitAndPr — autopilot label idempotency (AC-9)", () => {
  test("label exists → does NOT recreate", async () => {
    const { exec } = makeExec();
    const { gh, calls } = makeGh(null, true);
    await commitAndPr(defaultOpts(repo), { exec, gh });
    expect(calls.some((c) => c.method === "labelExists")).toBe(true);
    expect(calls.some((c) => c.method === "createLabel")).toBe(false);
  });

  test("label missing (404) → creates it then adds to PR", async () => {
    const { exec } = makeExec();
    const { gh, calls } = makeGh(null, false);
    await commitAndPr(defaultOpts(repo), { exec, gh });
    expect(calls.some((c) => c.method === "createLabel")).toBe(true);
    expect(calls.some((c) => c.method === "addLabelToPr")).toBe(true);
  });

  test("label `autopilot/v1` is the canonical name in label-related calls", async () => {
    const { exec } = makeExec();
    const { gh, calls } = makeGh(null, false);
    await commitAndPr(defaultOpts(repo), { exec, gh });
    const labelCall = calls.find((c) => c.method === "createLabel");
    expect((labelCall?.payload as { name: string }).name).toBe("autopilot/v1");
  });
});

describe("commitAndPr — secret-value scrubbing (AC-8)", () => {
  test("aborts (throws) if a configured secret value would leak into the PR body", async () => {
    const { exec } = makeExec();
    const { gh } = makeGh(null);
    // Plant a secret value inside verify.md content via a custom fixture.
    writeFileSync(
      join(repo, "docs/dev/PROJ-1/verify.md"),
      "# Verify report\n\nLeaked: sk-very-secret-value",
    );
    await expect(
      commitAndPr(
        defaultOpts(repo, { secrets: ["sk-very-secret-value"] }),
        { exec, gh },
      ),
    ).rejects.toThrow(/secret/i);
  });
});

describe("commitAndPr — dry-run path", () => {
  test("dryRun=true → no createPr / updatePr / git push calls", async () => {
    const { exec, recorded } = makeExec();
    const { gh, calls } = makeGh(null);
    await commitAndPr(defaultOpts(repo, { dryRun: true }), { exec, gh });
    expect(recorded.some((c) => c.cmd === "git" && c.args[0] === "push")).toBe(false);
    expect(calls.some((c) => c.method === "createPr" || c.method === "updatePr")).toBe(false);
  });
});
