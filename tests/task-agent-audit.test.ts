import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendReviewFeedbackToResumeBrief,
  persistValidatedAgentReturn,
} from "../src/core/orchestration/index.js";
import {
  extractAnalysisFromAssistantText,
  extractAnalysisFromSubagentResult,
} from "../src/core/subagent/index.js";

let tempCwd: string;
let originalCwd: string;

beforeEach(() => {
  originalCwd = process.cwd();
  tempCwd = mkdtempSync(join(tmpdir(), "accord-audit-"));
  process.chdir(tempCwd);
  mkdirSync(".tasks", { recursive: true });
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tempCwd, { recursive: true, force: true });
});

describe("task agent audit", () => {
  test("extractAnalysisFromAssistantText strips fenced JSON", () => {
    const text = [
      "## Check 1",
      "Adversarial impl found for AC-2.",
      "",
      "```json",
      '{"verdict":"issues","findings":[]}',
      "```",
    ].join("\n");
    expect(extractAnalysisFromAssistantText(text)).toContain("Adversarial impl");
    expect(extractAnalysisFromAssistantText(text)).not.toContain("verdict");
  });

  test("extractAnalysisFromSubagentResult reads last assistant message", () => {
    const analysis = extractAnalysisFromSubagentResult({
      messages: [
        {
          role: "assistant",
          content: [
            { type: "text", text: 'Narrative.\n\n```json\n{"verdict":"clean","findings":[]}\n```' },
          ],
        },
      ],
    });
    expect(analysis).toBe("Narrative.");
  });

  test("persistValidatedAgentReturn appends agent_returns and last_review_feedback", () => {
    writeFileSync(
      join(".tasks", "AUD-1.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        id: "AUD-1",
        title: "t",
        created: "2026-01-01T00:00:00.000Z",
        updated: "2026-01-01T00:00:00.000Z",
        pattern: "implement",
        phase: "implementing",
        task_ids: [1],
        spec: "x",
        plan: "x",
        verify: null,
        brief: null,
        decisions: [],
        deviations: [],
        cost_usd: 0,
      })}\n`,
      "utf8",
    );
    writeFileSync(
      join(".tasks", "AUD-1-task-1.json"),
      `${JSON.stringify({
        schema_version: "1.0",
        work_item_id: "AUD-1",
        task_id: 1,
        owner_nonce: "abcdef",
        phase: "review-test",
        status: "pending",
        events: [],
      })}\n`,
      "utf8",
    );

    persistValidatedAgentReturn(
      "AUD-1",
      "review-test",
      {
        verdict: "issues",
        findings: [{ severity: "critical", issue: "gap", evidence: "e" }],
      },
      { analysisText: "Full adversarial analysis prose." },
    );

    const task = JSON.parse(readFileSync(join(".tasks", "AUD-1-task-1.json"), "utf8")) as {
      agent_returns: Array<{ agent: string; analysis?: string; packet: { verdict: string } }>;
      last_review_feedback: { analysis?: string; packet: { verdict: string } };
    };
    expect(task.agent_returns).toHaveLength(1);
    expect(task.agent_returns[0]?.agent).toBe("review-test");
    expect(task.agent_returns[0]?.analysis).toContain("adversarial");
    expect(task.agent_returns[0]?.packet.verdict).toBe("issues");
    expect(task.last_review_feedback.analysis).toContain("adversarial");
    expect(task.last_review_feedback.packet.verdict).toBe("issues");

    const brief = appendReviewFeedbackToResumeBrief("AUD-1", "base", "phase-test");
    expect(brief).toContain("### Analysis (from task file)");
    expect(brief).toContain("adversarial");
    expect(brief).toContain("gap");
  });
});
