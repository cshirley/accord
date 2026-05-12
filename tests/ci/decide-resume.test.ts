import { describe, expect, test } from "bun:test";

import {
  decideResume,
  normaliseBrief,
  type ResumeOpts,
  type WorkItemState,
} from "../../scripts/ci/decide-resume.js";

const TICKET = "PROJ-123";

const SAMPLE_BRIEF = [
  "# PROJ-123: Add rate limit",
  "",
  "## Core Problem",
  "",
  "Anonymous callers hit the search endpoint and exhaust the pool.",
  "",
  "## Gathered Context",
  "",
  "- Jira ticket: PROJ-123",
  "- Status at trigger: Ready for Autopilot",
  "- Generated at 2026-05-11T15:00:00.000Z",
].join("\n");

function makeState(overrides: Partial<WorkItemState> = {}): WorkItemState {
  return {
    schema_version: "1.0",
    id: TICKET,
    phase: "implementing",
    cost_usd: 5,
    ...overrides,
  } as WorkItemState;
}

function makeOpts(overrides: Partial<ResumeOpts> = {}): ResumeOpts {
  return {
    ticket: TICKET,
    priorState: makeState(),
    priorBrief: SAMPLE_BRIEF,
    freshBrief: SAMPLE_BRIEF,
    maxCostUsd: 20,
    ...overrides,
  };
}

describe("decideResume — happy path (resume)", () => {
  test("phase=speccing, hash match, cost below → resume", () => {
    const r = decideResume(makeOpts({ priorState: makeState({ phase: "speccing" }) }));
    expect(r.decision).toBe("resume");
  });

  test("phase=planning, hash match, cost below → resume", () => {
    const r = decideResume(makeOpts({ priorState: makeState({ phase: "planning" }) }));
    expect(r.decision).toBe("resume");
  });

  test("phase=implementing, hash match, cost below → resume", () => {
    const r = decideResume(makeOpts());
    expect(r.decision).toBe("resume");
  });
});

describe("decideResume — phase_non_resumable", () => {
  for (const phase of ["verifying", "complete", "blocked", "aligning"]) {
    test(`phase=${phase} → fresh / phase_non_resumable`, () => {
      const r = decideResume(makeOpts({ priorState: makeState({ phase }) }));
      expect(r.decision).toBe("fresh");
      if (r.decision === "fresh") {
        expect(r.reason).toBe("phase_non_resumable");
      }
    });
  }
});

describe("decideResume — brief_drift", () => {
  test("hash mismatch alone → fresh / brief_drift", () => {
    const r = decideResume(
      makeOpts({ freshBrief: SAMPLE_BRIEF.replace("Add rate limit", "Add CACHING") }),
    );
    expect(r.decision).toBe("fresh");
    if (r.decision === "fresh") {
      expect(r.reason).toBe("brief_drift");
    }
  });
});

describe("decideResume — cost_cap_breached", () => {
  test("cost equal to cap → fresh / cost_cap_breached (strict <)", () => {
    const r = decideResume(makeOpts({ priorState: makeState({ cost_usd: 20 }) }));
    expect(r.decision).toBe("fresh");
    if (r.decision === "fresh") {
      expect(r.reason).toBe("cost_cap_breached");
    }
  });

  test("cost above cap → fresh / cost_cap_breached", () => {
    const r = decideResume(makeOpts({ priorState: makeState({ cost_usd: 25 }) }));
    expect(r.decision).toBe("fresh");
    if (r.decision === "fresh") {
      expect(r.reason).toBe("cost_cap_breached");
    }
  });

  test("cost strictly below cap → resume (boundary)", () => {
    const r = decideResume(makeOpts({ priorState: makeState({ cost_usd: 19.999 }) }));
    expect(r.decision).toBe("resume");
  });
});

describe("decideResume — no_prior_state", () => {
  test("priorState=null → fresh / no_prior_state", () => {
    const r = decideResume(makeOpts({ priorState: null, priorBrief: null }));
    expect(r.decision).toBe("fresh");
    if (r.decision === "fresh") {
      expect(r.reason).toBe("no_prior_state");
    }
  });

  test("priorState=null even when prior brief exists → no_prior_state (state is authoritative)", () => {
    const r = decideResume(makeOpts({ priorState: null }));
    expect(r.decision).toBe("fresh");
    if (r.decision === "fresh") {
      expect(r.reason).toBe("no_prior_state");
    }
  });
});

describe("decideResume — precedence of fresh reasons", () => {
  test("no_prior_state beats phase_non_resumable (priorState null trumps everything)", () => {
    const r = decideResume(
      makeOpts({
        priorState: null,
        priorBrief: SAMPLE_BRIEF.replace("Add", "Drift"),
      }),
    );
    expect(r.decision).toBe("fresh");
    if (r.decision === "fresh") {
      expect(r.reason).toBe("no_prior_state");
    }
  });

  test("phase_non_resumable beats brief_drift", () => {
    const r = decideResume(
      makeOpts({
        priorState: makeState({ phase: "complete" }),
        freshBrief: SAMPLE_BRIEF.replace("Add", "Drift"),
      }),
    );
    expect(r.decision).toBe("fresh");
    if (r.decision === "fresh") {
      expect(r.reason).toBe("phase_non_resumable");
    }
  });

  test("brief_drift beats cost_cap_breached", () => {
    const r = decideResume(
      makeOpts({
        priorState: makeState({ cost_usd: 25 }),
        freshBrief: SAMPLE_BRIEF.replace("Add", "Drift"),
      }),
    );
    expect(r.decision).toBe("fresh");
    if (r.decision === "fresh") {
      expect(r.reason).toBe("brief_drift");
    }
  });
});

describe("decideResume — cleanupPaths on fresh branch", () => {
  test("fresh decision includes .tasks/<ticket>* cleanup paths", () => {
    const r = decideResume(makeOpts({ priorState: makeState({ phase: "complete" }) }));
    expect(r.decision).toBe("fresh");
    if (r.decision === "fresh") {
      expect(r.cleanupPaths).toContain(`.tasks/${TICKET}.json`);
      expect(r.cleanupPaths).toContain(`.tasks/${TICKET}-usage.jsonl`);
      expect(r.cleanupPaths).toContain(`.tasks/${TICKET}-checkpoint.json`);
    }
  });

  test("resume decision has no cleanup paths", () => {
    const r = decideResume(makeOpts());
    expect(r.decision).toBe("resume");
    if (r.decision === "resume") {
      // No cleanupPaths field on resume — strictly distinguishable.
      expect("cleanupPaths" in r).toBe(false);
    }
  });
});

describe("decideResume — opening Jira comment payload", () => {
  test("resume → comment carries 'resume' branch label + ticket", () => {
    const r = decideResume(makeOpts());
    expect(r.openingJiraComment.branch).toBe("resume");
    expect(r.openingJiraComment.body).toContain(TICKET);
    expect(r.openingJiraComment.body).toMatch(/resum/i);
  });

  test("fresh/brief_drift → comment carries 'fresh' branch + reason verbatim", () => {
    const r = decideResume(makeOpts({ freshBrief: SAMPLE_BRIEF.replace("Add", "Drift") }));
    expect(r.openingJiraComment.branch).toBe("fresh");
    expect(r.openingJiraComment.body).toContain("brief_drift");
  });

  test("fresh/cost_cap_breached → comment carries reason verbatim", () => {
    const r = decideResume(makeOpts({ priorState: makeState({ cost_usd: 25 }) }));
    expect(r.openingJiraComment.branch).toBe("fresh");
    expect(r.openingJiraComment.body).toContain("cost_cap_breached");
  });
});

describe("normaliseBrief — invariants used by AC-16 hash equality", () => {
  test("strips `Generated at <ISO>` line completely", () => {
    const md = "preamble\n- Generated at 2026-05-11T15:00:00.000Z\npostlude";
    const n = normaliseBrief(md);
    expect(n).not.toContain("Generated at");
    expect(n).not.toContain("2026");
  });

  test("collapses internal whitespace runs to single spaces", () => {
    const md = "hello   world\t\ttwo";
    const n = normaliseBrief(md);
    expect(n).toContain("hello world two");
  });

  test("trims trailing whitespace on lines", () => {
    const md = "line one   \nline two\t\n";
    const n = normaliseBrief(md);
    expect(n.split("\n").every((l) => !/[ \t]$/.test(l))).toBe(true);
  });

  test("two briefs differing only by inserted blank line + different timestamp → same normalised string", () => {
    const a = ["## Gathered Context", "- Generated at 2026-05-11T15:00:00.000Z", "more"].join("\n");
    const b = ["## Gathered Context", "", "- Generated at 2026-05-12T09:30:00.000Z", "more"].join(
      "\n",
    );
    expect(normaliseBrief(a)).toBe(normaliseBrief(b));
  });
});

describe("decideResume — brief-normalisation hash equality (AC-16b)", () => {
  test("priorBrief and freshBrief differing only by timestamp/whitespace → resume", () => {
    const prior = [
      "## Gathered Context",
      "- Generated at 2026-05-11T15:00:00.000Z",
      "shared content",
    ].join("\n");
    const fresh = [
      "## Gathered Context",
      "",
      "- Generated at 2026-05-12T09:30:00.000Z   ",
      "shared content",
    ].join("\n");
    const r = decideResume(makeOpts({ priorBrief: prior, freshBrief: fresh }));
    expect(r.decision).toBe("resume");
  });
});
