import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildCursorAgentPrompt,
  inferAgentNamespace,
  loadAgentFromSpawnFile,
  resolveCursorAgentModel,
  runCursorAgentExec,
} from "../src/harnesses/cursor-agent-exec.js";
import { formatCursorAgentCliModel } from "../src/harnesses/cursor-agent-model.js";
import { resolveModelConfig } from "@clive.shirley/accord-core/agents/index.js";
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

describe("cursor agent model formatting", () => {
  test("maps gpt reasoning effort to bracket syntax", () => {
    expect(
      formatCursorAgentCliModel({
        provider: "cursor",
        model: "gpt-5.4",
        thinkingMode: "reasoning_effort",
        thinking: "xhigh",
      }),
    ).toBe("gpt-5.4[effort=high]");
  });

  test("keeps claude thinking model when tier already encodes effort", () => {
    expect(
      formatCursorAgentCliModel({
        provider: "cursor",
        model: "claude-opus-5-thinking",
        thinkingMode: "flag",
        thinking: "high",
      }),
    ).toBe("claude-opus-5-thinking");
  });

  test("applies bracket effort for non-thinking base models", () => {
    expect(
      formatCursorAgentCliModel({
        provider: "cursor",
        model: "composer-2.5",
        thinkingMode: "flag",
        thinking: "xhigh",
      }),
    ).toBe("composer-2.5[effort=high]");
  });
});

describe("cursor agent prompt building", () => {
  test("omits yaml frontmatter from prompt body", () => {
    const prompt = buildCursorAgentPrompt({
      agentBody: "You are the align agent.\n\nDo the thing.",
      systemAppend: "## Project Stack\nlanguage: typescript",
      task: "work_item_id: DEMO-1",
    });
    expect(prompt).not.toMatch(/^---\nname:/);
    expect(prompt).toContain("You are the align agent.");
    expect(prompt).toContain("## Project Stack");
    expect(prompt).toContain("work_item_id: DEMO-1");
  });

  test("infers accord namespace from agent path", () => {
    expect(inferAgentNamespace(PHASE_ALIGN)).toBe("accord");
  });
});

describe("cursor agent model resolution from frontmatter", () => {
  test("resolves reasoning tier for phase-align", () => {
    const model = resolveCursorAgentModel(PHASE_ALIGN);
    expect(model).toBeTruthy();
    expect(model).toMatch(/opus|thinking/i);
  });

  test("honours review-code thinking override with review profile", () => {
    const agent = loadAgentFromSpawnFile(REVIEW_CODE);
    expect(agent).toBeTruthy();
    if (!agent) return;

    const resolved = resolveModelConfig(agent, {
      defaultProfile: "anthropic-direct",
      reviewProfile: "openai-review",
      profiles: {
        "anthropic-direct": {
          provider: "anthropic",
          thinkingMode: "flag",
          tiers: {
            workhorse: { model: "claude-sonnet-4-6", thinking: "medium" },
          },
        },
        "openai-review": {
          provider: "cursor",
          thinkingMode: "reasoning_effort",
          tiers: {
            workhorse: { model: "gpt-5.4", reasoningEffort: "high" },
          },
        },
      },
    });
    expect(resolved).toBeTruthy();
    const model = formatCursorAgentCliModel(resolved!);
    expect(model).toMatch(/gpt-5\.4/i);
    expect(model).toMatch(/effort=high|xhigh/i);
  });
});

describe("cursor agent exec spawn (mock)", () => {
  test("passes body-only prompt after -- and sets --model from frontmatter", async () => {
    const mockDir = fs.mkdtempSync(path.join(os.tmpdir(), "accord-cursor-mock-"));
    const mockBin = path.join(mockDir, "mock-agent");
    fs.writeFileSync(
      mockBin,
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        'MODEL=""',
        'PROMPT=""',
        "while [[ $# -gt 0 ]]; do",
        '  case "$1" in',
        '    --model) MODEL="$2"; shift 2 ;;',
        '    --) shift; PROMPT="$*"; break ;;',
        "    *) shift ;;",
        "  esac",
        "done",
        'echo "model=$MODEL"',
        "if echo \"$PROMPT\" | rg -q '^name: phase-align'; then echo prompt_has_yaml_frontmatter=1; else echo prompt_has_yaml_frontmatter=0; fi",
        "echo '\\`\\`\\`json'",
        'echo \'{"status":"done","summary":"mock","usage":{"prompt_tokens":1,"completion_tokens":1}}\'',
        "echo '\\`\\`\\`'",
      ].join("\n"),
      { mode: 0o755 },
    );

    const taskFile = writeExecTaskFile(process.cwd(), "phase-align", "Return packet smoke.");
    const result = await runCursorAgentExec(
      { taskFile, agentFile: PHASE_ALIGN, cwd: process.cwd() },
      { agentBin: mockBin },
    );

    expect(result.exitCode).toBe(0);
    expect(result.model).toMatch(/opus|thinking/i);
    expect(result.stdout).toContain("model=");
    expect(result.stdout).toContain("prompt_has_yaml_frontmatter=0");
    expect(result.stdout).toContain('"status":"done"');
  });
});
