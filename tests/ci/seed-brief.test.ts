import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { seedBrief, slugify } from "../../scripts/ci/seed-brief.js";
import type { JiraIssue } from "../../scripts/ci/gate-ticket.js";

const PASSING: JiraIssue = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures/jira/gate-passing.json"), "utf8"),
);

let outDir: string;

beforeEach(() => {
  outDir = mkdtempSync(join(tmpdir(), "accord-seed-brief-"));
});

afterEach(() => {
  rmSync(outDir, { recursive: true, force: true });
});

describe("seedBrief — output shape", () => {
  test("writes brief.md and returns its absolute path", () => {
    const { briefPath } = seedBrief({ ticket: PASSING, outDir });
    expect(briefPath).toBe(join(outDir, "brief.md"));
    expect(existsSync(briefPath)).toBe(true);
  });

  test("returns the slug derived from the ticket summary", () => {
    const { slug } = seedBrief({ ticket: PASSING, outDir });
    expect(slug).toBe("add-per-call-rate-limit-on-the-public-search-endpoint");
  });
});

describe("seedBrief — canonical phase-align sections (TC-13 shape)", () => {
  test("brief contains all four canonical sections", () => {
    seedBrief({ ticket: PASSING, outDir });
    const md = readFileSync(join(outDir, "brief.md"), "utf8");
    expect(md).toContain("## Core Problem");
    expect(md).toContain("## Desired Outcome");
    expect(md).toContain("## Scope");
    expect(md).toContain("## Gathered Context");
  });

  test("brief embeds ticket key, summary, and description verbatim", () => {
    seedBrief({ ticket: PASSING, outDir });
    const md = readFileSync(join(outDir, "brief.md"), "utf8");
    expect(md).toContain(PASSING.key);
    expect(md).toContain(PASSING.fields.summary);
    // a distinctive substring from the description
    expect(md).toContain("INC-1023");
  });

  test("brief embeds status and issue type verbatim", () => {
    seedBrief({ ticket: PASSING, outDir });
    const md = readFileSync(join(outDir, "brief.md"), "utf8");
    expect(md).toContain(PASSING.fields.status.name);
    expect(md).toContain(PASSING.fields.issuetype.name);
  });

  test("gathered-context section carries a `Generated at <UTC ISO>` line", () => {
    seedBrief({ ticket: PASSING, outDir });
    const md = readFileSync(join(outDir, "brief.md"), "utf8");
    const ctxStart = md.indexOf("## Gathered Context");
    expect(ctxStart).toBeGreaterThan(-1);
    const ctxSection = md.slice(ctxStart);
    expect(ctxSection).toMatch(/Generated at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/);
  });

  test("gathered-context timestamp is inside the section, not in a different one", () => {
    seedBrief({ ticket: PASSING, outDir });
    const md = readFileSync(join(outDir, "brief.md"), "utf8");
    const tsMatch = /Generated at \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z/.exec(md);
    expect(tsMatch).not.toBeNull();
    if (tsMatch) {
      const before = md.slice(0, tsMatch.index);
      const lastSection = before.match(/##\s+([^\n]+)/g)?.pop() ?? "";
      expect(lastSection).toContain("Gathered Context");
    }
  });
});

describe("seedBrief — idempotency", () => {
  test("second call overwrites the first (no throw, content updates)", () => {
    seedBrief({ ticket: PASSING, outDir });
    const first = readFileSync(join(outDir, "brief.md"), "utf8");

    const mutated: JiraIssue = {
      ...PASSING,
      fields: { ...PASSING.fields, summary: "CHANGED summary value" },
    };
    seedBrief({ ticket: mutated, outDir });
    const second = readFileSync(join(outDir, "brief.md"), "utf8");

    expect(second).toContain("CHANGED summary value");
    expect(second).not.toBe(first);
  });
});

describe("slugify (used by AC-11 branch naming)", () => {
  test("lowercases and dash-delimits a simple sentence", () => {
    expect(slugify("Add Rate Limit")).toBe("add-rate-limit");
  });

  test("collapses runs of spaces / punctuation to a single dash", () => {
    expect(slugify("Hello,   world!!! How --- now?")).toBe("hello-world-how-now");
  });

  test("strips leading and trailing dashes", () => {
    expect(slugify("  ---hello---  ")).toBe("hello");
  });

  test("drops non-ASCII punctuation but keeps alphanumerics", () => {
    expect(slugify("Café résumé 2026 — naïve")).toBe("caf-r-sum-2026-na-ve");
  });

  test("returns 'untitled' for an all-punctuation summary", () => {
    expect(slugify("!!!---???")).toBe("untitled");
  });

  test("returns 'untitled' for an empty string", () => {
    expect(slugify("")).toBe("untitled");
  });

  test("caps slug length at 60 chars (deterministic truncation, no trailing dash)", () => {
    const long = "a".repeat(80) + " end";
    const out = slugify(long);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out.endsWith("-")).toBe(false);
  });

  test("handles a very long summary with mixed content without exceeding 60 chars", () => {
    const long =
      "This is a very, very, VERY long summary that goes on and on with lots of words and punctuation!!!";
    const out = slugify(long);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out).toMatch(/^[a-z0-9-]+$/);
  });

  test("is deterministic (same input → same output)", () => {
    const a = slugify("Same Input");
    const b = slugify("Same Input");
    expect(a).toBe(b);
  });
});

describe("seedBrief — special characters in summary", () => {
  test("ticket with special-char summary still produces a clean brief", () => {
    const ticket: JiraIssue = {
      ...PASSING,
      fields: { ...PASSING.fields, summary: "Fix [BUG] in /v2/search & API!" },
    };
    const { briefPath, slug } = seedBrief({ ticket, outDir });
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(existsSync(briefPath)).toBe(true);
  });
});
