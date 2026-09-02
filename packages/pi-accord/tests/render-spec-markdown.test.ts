import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { renderSpecMarkdown } from "@clive.shirley/accord-core/artifacts/render-spec-markdown.js";
import { syncSpecMarkdownFromJson } from "@clive.shirley/accord-core/artifacts/spec-markdown.js";

describe("renderSpecMarkdown", () => {
  test("renders AC headings and mermaid diagrams by section", () => {
    const md = renderSpecMarkdown({
      schema_version: "1.0",
      work_item_id: "ACCORD-99",
      title: "Refresh tokens",
      date: "2026-05-27",
      problem_statement: "Sessions expire without refresh.",
      proposed_solution: "Add refresh endpoint and client retry.",
      acceptance_criteria: [
        {
          id: "AC-1",
          requirement: "MUST",
          type: "scenario",
          scenario:
            "Given an expired access token, When the client refreshes, Then it receives a new token.",
        },
      ],
      scope: { in: ["src/auth"], out: [] },
      verification: { commands: ["bun test"], test_cases: [] },
      diagrams: [
        {
          section: "proposed_solution",
          caption: "Refresh flow",
          mermaid: "sequenceDiagram\n  A->>B: refresh",
        },
      ],
    });

    expect(md).toContain("# Spec: ACCORD-99");
    expect(md).toContain("### AC-1 (MUST, scenario)");
    expect(md).toContain("```mermaid");
    expect(md).toContain("Refresh flow");
    expect(md).toContain("Authoritative contract");
  });

  const fixtureSpecPath = join(
    import.meta.dir,
    "fixtures",
    "docs",
    "dev",
    "SPEC-SYNC-1",
    "spec.json",
  );
  const fixtureSpecMdPath = join(
    import.meta.dir,
    "fixtures",
    "docs",
    "dev",
    "SPEC-SYNC-1",
    "spec.md",
  );

  afterEach(() => {
    try {
      rmSync(fixtureSpecMdPath, { force: true });
    } catch {
      /* ignore */
    }
  });

  test("syncSpecMarkdownFromJson writes spec.md beside fixture spec.json", () => {
    const result = syncSpecMarkdownFromJson(fixtureSpecPath);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);

    const md = readFileSync(result.value.specMdPath, "utf8");
    expect(md).toContain("SPEC-SYNC-1");
    expect(md).toContain("### AC-1");
  });
});
