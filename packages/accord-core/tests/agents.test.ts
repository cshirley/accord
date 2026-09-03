import { describe, expect, test } from "bun:test";
import * as path from "node:path";
import { loadAgentFromFile, resolveModelConfig } from "../src/agents/index.js";

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");
const PHASE_ALIGN = path.join(
  REPO_ROOT,
  "packages/accord-assets/agents/accord/phase-align.md",
);

describe("loadAgentFromFile", () => {
  test("loads agent markdown with nested tools frontmatter", () => {
    const agent = loadAgentFromFile(PHASE_ALIGN, { source: "explicit", namespace: "accord" });
    expect(agent?.name).toBe("phase-align");
    expect(agent?.tier).toBe("reasoning");
    expect(agent?.tools).toContain("read");
    expect(agent?.tools).toContain("bash");
    expect(agent?.systemPrompt).toContain("entry point");
    expect(agent?.systemPrompt).not.toMatch(/^---\nname:/);
  });
});

describe("parseSubagentReturnJson", () => {
  test("extracts the last json fenced block", async () => {
    const { parseSubagentReturnJson } = await import("../src/agents/response-contract.js");
    const parsed = parseSubagentReturnJson('text\n```json\n{"a":1}\n```\nmore\n```json\n{"b":2}\n```');
    expect(parsed).toEqual({ b: 2 });
  });
});

describe("resolveModelConfig", () => {
  test("honours explicit model frontmatter pin", () => {
    const agent = loadAgentFromFile(PHASE_ALIGN, { source: "explicit" });
    expect(agent).toBeTruthy();
    if (!agent) return;

    const resolved = resolveModelConfig(
      { ...agent, model: "cursor/composer-2.5", thinking: "high" },
      {
        defaultProfile: "default",
        profiles: {
          default: {
            provider: "anthropic",
            thinkingMode: "flag",
            tiers: {
              workhorse: { model: "claude-sonnet-4-6", thinking: "medium" },
            },
          },
        },
      },
    );

    expect(resolved).toEqual({
      provider: "cursor",
      model: "composer-2.5",
      thinkingMode: "flag",
      thinking: "high",
    });
  });
});
