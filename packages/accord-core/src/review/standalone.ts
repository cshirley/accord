/**
 * Standalone diff review — core helpers for `/review` skill and `accord review`.
 */

import { git } from "../git/helpers.js";
import { extractReturnPacketFromSubagentResult } from "../subagent/result/packet.js";
import { err, ok, type Result } from "../types/result.js";

const TEST_FILE_PATTERN =
  /(?:\.(?:test|spec)\.|_test\.(?:go|rs)$|test_.*\.py$|_spec\.rb$|Test\.java$|Tests\.cs$|\/(?:test|__tests__|tests|spec)\/)/i;

const MAX_DIFF_BYTES = 512 * 1024;
const MAX_TEST_OUTPUT_BYTES = 64 * 1024;

export type StandaloneReviewDiff = {
  diff: string;
  file_list: string[];
  source: "staged" | "unstaged" | "branch";
};

export type StandaloneReviewTask = {
  agent: string;
  task: string;
};

export type StandaloneReviewFinding = {
  severity: string;
  message: string;
  agent?: string;
};

export type StandaloneReviewAgentResult = {
  agent: string;
  exit_code: number;
  findings: StandaloneReviewFinding[];
  verdict?: string;
  error?: string;
};

export type StandaloneReviewReport = {
  agents: StandaloneReviewAgentResult[];
  formatted: string;
  counts: {
    simplification: number;
    quality: number;
    security: number;
    test_quality: number;
  };
};

export function isStandaloneReviewTestFile(filePath: string): boolean {
  return TEST_FILE_PATTERN.test(filePath);
}

export async function gatherStandaloneReviewDiff(
  cwd: string,
): Promise<Result<StandaloneReviewDiff>> {
  try {
    const stagedDiff = await git(["diff", "--staged"], cwd);
    const stagedFiles = (await git(["diff", "--staged", "--name-only"], cwd))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (stagedDiff.trim() || stagedFiles.length > 0) {
      return ok({
        diff: truncateText(stagedDiff, MAX_DIFF_BYTES),
        file_list: stagedFiles,
        source: "staged",
      });
    }

    const unstagedDiff = await git(["diff"], cwd);
    const unstagedFiles = (await git(["diff", "--name-only"], cwd))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (unstagedDiff.trim() || unstagedFiles.length > 0) {
      return ok({
        diff: truncateText(unstagedDiff, MAX_DIFF_BYTES),
        file_list: unstagedFiles,
        source: "unstaged",
      });
    }

    const branchDiff = await git(["diff", "origin/HEAD...HEAD"], cwd);
    const branchFiles = (await git(["diff", "--name-only", "origin/HEAD...HEAD"], cwd))
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    if (branchDiff.trim() || branchFiles.length > 0) {
      return ok({
        diff: truncateText(branchDiff, MAX_DIFF_BYTES),
        file_list: branchFiles,
        source: "branch",
      });
    }

    return err("No diff found (staged, unstaged, or origin/HEAD...HEAD).");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return err(`Failed to gather git diff: ${message}`);
  }
}

export function buildStandaloneReviewTasks(input: {
  diff: string;
  file_list: string[];
  test_output?: string;
}): StandaloneReviewTask[] {
  const fileList = input.file_list.join(", ") || "(none)";
  const diff = input.diff.trim() || "(empty diff)";
  const testOutput = input.test_output?.trim() || "(not run)";

  const tasks: StandaloneReviewTask[] = [
    {
      agent: "review-code",
      task: `Review the following diff. There is no spec or plan — skip the Drift section entirely. Changed files: \`${fileList}\`. Diff:\n\n${diff}`,
    },
    {
      agent: "review-security",
      task: `Review the following diff for security issues (OWASP A01–A10). There is no spec or plan — infer intent from the diff only. Flag only security-relevant issues; general correctness belongs to review-code. Changed files: \`${fileList}\`. Diff:\n\n${diff}`,
    },
  ];

  const hasTests = input.file_list.some(isStandaloneReviewTestFile);
  if (hasTests) {
    tasks.push({
      agent: "review-test",
      task: `Review test quality in the following diff. \`mode: post-impl\`. There is no spec — skip Check 1 (per-AC adversarial analysis against spec ACs), Check 3/3b (AC negation and inventory), and Check 7 (spec contract). Run Checks 1b, 2, 4, 5, and 6 on changed tests. Changed files: \`${fileList}\`. Diff:\n\n${diff}\n\nTest output:\n${testOutput}`,
    });
  }

  return tasks;
}

export function parseStandaloneReviewAgentResult(
  agent: string,
  spawnResult: { exitCode: number; parsedReturn?: unknown; output?: string; stderr?: string },
): StandaloneReviewAgentResult {
  const packet =
    spawnResult.parsedReturn && typeof spawnResult.parsedReturn === "object"
      ? (spawnResult.parsedReturn as Record<string, unknown>)
      : extractReturnPacketFromSubagentResult({
          exitCode: spawnResult.exitCode,
          parsedReturn: spawnResult.parsedReturn,
          output: spawnResult.output,
          stderr: spawnResult.stderr,
        });

  const findings = extractFindings(packet, agent);
  const verdict = typeof packet?.verdict === "string" ? packet.verdict : undefined;

  return {
    agent,
    exit_code: spawnResult.exitCode,
    findings,
    verdict,
    ...(spawnResult.exitCode !== 0
      ? {
          error:
            typeof spawnResult.stderr === "string" && spawnResult.stderr.trim()
              ? spawnResult.stderr.trim()
              : "subagent exited with non-zero status",
        }
      : {}),
  };
}

export function synthesizeStandaloneReviewReport(
  agents: StandaloneReviewAgentResult[],
): StandaloneReviewReport {
  const allFindings = agents.flatMap((agentResult) => agentResult.findings);

  const critical = allFindings.filter((finding) => isSeverity(finding, "critical"));
  const warnings = allFindings.filter((finding) => isSeverity(finding, "warning"));
  const suggestions = allFindings.filter((finding) => isSeverity(finding, "suggestion"));

  const securityAgent = agents.find((agentResult) => agentResult.agent === "review-security");
  const testAgent = agents.find((agentResult) => agentResult.agent === "review-test");

  const securityFindings = securityAgent?.findings ?? [];
  const testFindings = testAgent?.findings ?? [];

  const counts = {
    simplification: suggestions.length,
    quality: critical.length + warnings.length,
    security: securityFindings.filter((finding) => !isSeverity(finding, "suggestion")).length,
    test_quality: testFindings.filter((finding) => !isSeverity(finding, "suggestion")).length,
  };

  const lines: string[] = ["## Review", ""];

  lines.push("### Critical", formatFindingBlock(critical), "");
  lines.push("### Warnings", formatFindingBlock(warnings), "");
  lines.push("### Suggestions", formatFindingBlock(suggestions), "");
  lines.push(
    "### Security",
    securityFindings.length > 0
      ? formatFindingBlock(securityFindings)
      : "No security issues found.",
    "",
  );

  if (testAgent) {
    lines.push(
      "### Test Quality",
      testFindings.length > 0 ? formatFindingBlock(testFindings) : "No test issues found.",
      "",
    );
  }

  const failed = agents.filter((agentResult) => agentResult.exit_code !== 0);
  if (failed.length > 0) {
    lines.push(
      "### Agent failures",
      failed
        .map((agentResult) => `- ${agentResult.agent}: ${agentResult.error ?? "failed"}`)
        .join("\n"),
      "",
    );
  }

  lines.push(
    "---",
    `Simplification opportunities: ${String(counts.simplification)}`,
    `Quality issues: ${String(counts.quality)}`,
    `Security issues: ${String(counts.security)}`,
    `Test quality issues: ${String(testAgent ? counts.test_quality : 0)}`,
  );

  return {
    agents,
    formatted: lines.join("\n"),
    counts,
  };
}

function extractFindings(
  packet: Record<string, unknown> | null,
  agent: string,
): StandaloneReviewFinding[] {
  if (!packet || !Array.isArray(packet.findings)) {
    return [];
  }

  return packet.findings
    .filter(
      (entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object",
    )
    .map((entry) => ({
      severity: typeof entry.severity === "string" ? entry.severity : "warning",
      message:
        typeof entry.message === "string"
          ? entry.message
          : typeof entry.summary === "string"
            ? entry.summary
            : JSON.stringify(entry),
      agent,
    }));
}

function isSeverity(finding: StandaloneReviewFinding, severity: string): boolean {
  return finding.severity.toLowerCase() === severity;
}

function formatFindingBlock(findings: StandaloneReviewFinding[]): string {
  if (findings.length === 0) {
    return "(none)";
  }
  return findings
    .map(
      (finding) => `- **${finding.agent ?? "review"}** (${finding.severity}): ${finding.message}`,
    )
    .join("\n");
}

function truncateText(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) {
    return text;
  }
  return `${text.slice(-maxBytes)}\n…(truncated)`;
}

export function truncateStandaloneTestOutput(text: string): string {
  return truncateText(text, MAX_TEST_OUTPUT_BYTES);
}
