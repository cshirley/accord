import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runClaudeCodeExec } from "../src/harnesses/claude-code-exec.js";
import { formatClaudeCodeCliEffort, formatClaudeCodeCliModel } from "../src/harnesses/claude-code-model.js";
import { formatClaudeCodeTools, loadAgentFromSpawnFile, resolveSpawnModelFromAgentFile } from "../src/harnesses/exec-agent-shared.js";
import { resolveCursorAgentModel } from "../src/harnesses/cursor-agent-exec.js";
import { writeExecTaskFile } from "../src/harnesses/exec-template.js";

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");
const PHASE_ALIGN = path.join(
  REPO_ROOT,
  "packages/accord-assets/agents/accord/phase-align.md",
);
const REVIEW_CODE = path.join(
  REPO_ROOT,
  "packages/accord-assets/agents/accord/review-code.md",
);

describe("claude code model formatting", () => {
  test("strips provider prefix from model id", () => {
    expect(
      formatClaudeCodeCliModel({
        provider: "anthropic",
        model: "claude-opus-4-7",
        thinkingMode: "flag",
        thinking: "high",
      }),
    ).toBe("claude-opus-4-7");
  });

  test("maps thinking frontmatter to effort flag", () => {
    expect(
      formatClaudeCodeCliEffort({
        provider: "anthropic",
        model: "claude-sonnet-4-6",
        thinkingMode: "flag",
        thinking: "xhigh",
      }),
    ).toBe("xhigh");
  });
});

describe("claude code tool mapping", () => {
  test("maps accord agent tools to Claude Code names", () => {
    const agent = loadAgentFromSpawnFile(PHASE_ALIGN);
    expect(formatClaudeCodeTools(agent)).toEqual(
      expect.arrayContaining(["Read", "Grep", "Glob", "Bash", "Write"]),
    );
  });

  test("review-code is read-only", () => {
    const agent = loadAgentFromSpawnFile(REVIEW_CODE);
    expect(formatClaudeCodeTools(agent)).toEqual(["Read", "Grep", "Glob"]);
  });
});

describe("claude code model resolution from frontmatter", () => {
  test("resolves anthropic model for phase-align", () => {
    const resolved = resolveSpawnModelFromAgentFile(PHASE_ALIGN);
    expect(resolved).toBeTruthy();
    expect(formatClaudeCodeCliModel(resolved!)).toMatch(/claude/i);
    expect(formatClaudeCodeCliEffort(resolved!)).toBeTruthy();
  });
});

describe("claude code exec spawn (mock)", () => {
  test("passes system prompt, effort, model, and task separately", async () => {
    const mockDir = fs.mkdtempSync(path.join(os.tmpdir(), "accord-claude-mock-"));
    const mockBin = path.join(mockDir, "mock-claude");
    const logFile = path.join(mockDir, "args.log");
    fs.writeFileSync(
      mockBin,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        `LOG_FILE="${logFile}"`,
        'MODEL=""',
        'EFFORT=""',
        'SYSTEM=""',
        'APPEND=""',
        'TOOLS=""',
        'TASK=""',
        "while [[ $# -gt 0 ]]; do",
        '  case "$1" in',
        '    --model) MODEL="$2"; shift 2 ;;',
        '    --effort) EFFORT="$2"; shift 2 ;;',
        '    --system-prompt) SYSTEM="$2"; shift 2 ;;',
        '    --append-system-prompt) APPEND="$2"; shift 2 ;;',
        '    --tools) TOOLS="$2"; shift 2 ;;',
        '    -p|--print|--output-format|--dangerously-skip-permissions) shift ;;',
        '    text) shift ;;',
        "    *) TASK=\"$1\"; shift ;;",
        "  esac",
        "done",
        'printf "model=%s\\neffort=%s\\ntools=%s\\n" "$MODEL" "$EFFORT" "$TOOLS" > "$LOG_FILE"',
        'if echo "$SYSTEM" | rg -q "^name: phase-align"; then echo system_has_yaml_frontmatter=1 >> "$LOG_FILE"; else echo system_has_yaml_frontmatter=0 >> "$LOG_FILE"; fi',
        'if echo "$SYSTEM" | rg -q "Role in the Pipeline"; then echo system_has_body=1 >> "$LOG_FILE"; else echo system_has_body=0 >> "$LOG_FILE"; fi',
        "echo '\\`\\`\\`json'",
        'echo \'{"status":"done","summary":"mock","usage":{"prompt_tokens":1,"completion_tokens":1}}\'',
        "echo '\\`\\`\\`'",
      ].join("\n"),
      { mode: 0o755 },
    );

    const taskFile = writeExecTaskFile(process.cwd(), "phase-align", "Return packet smoke.");
    const result = await runClaudeCodeExec(
      {
        taskFile,
        agentFile: PHASE_ALIGN,
        systemAppendFile: undefined,
        cwd: process.cwd(),
      },
      { claudeBin: mockBin },
    );

    const log = fs.readFileSync(logFile, "utf8");
    expect(result.exitCode).toBe(0);
    expect(log).toMatch(/model=.*claude/i);
    expect(log).toMatch(/effort=/);
    expect(log).toContain("system_has_yaml_frontmatter=0");
    expect(log).toContain("system_has_body=1");
    expect(log).toMatch(/tools=Read/);
    expect(result.stdout).toContain('"status":"done"');
  });
});
