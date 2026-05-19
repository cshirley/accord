import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  formatResponseContractAppendix,
  loadAgentFromFile,
  parseSubagentReturnJson,
  resolveSpawnAgent,
} from "../packages/pi-subagent/src/api.js";
import {
  buildSubagentResponseContract,
  resolveHarnessAgentFile,
} from "../src/core/harness/subagent-spawn-payload.js";

describe("loadAgentFromFile", () => {
  test("loads bundled phase-code agent", () => {
    const filePath = join(process.cwd(), "assets/agents/accord/phase-code.md");
    const agent = loadAgentFromFile(filePath);
    expect(agent?.name).toBe("phase-code");
    expect(agent?.tier).toBe("workhorse");
    expect(agent?.systemPrompt).toContain("production code");
  });
});

describe("resolveSpawnAgent", () => {
  test("prefers agentFile over name", () => {
    const filePath = join(process.cwd(), "assets/agents/accord/phase-spec.md");
    const resolved = resolveSpawnAgent({
      cwd: process.cwd(),
      agent: "phase-code",
      agentFile: filePath,
    });
    expect(resolved.agent?.name).toBe("phase-spec");
  });
});

describe("response contract", () => {
  test("formatResponseContractAppendix includes schema path content", () => {
    const schemaPath = join(process.cwd(), "schemas/return-schemas/phase-code.json");
    const appendix = formatResponseContractAppendix({
      format: "json_schema_path",
      schemaPath,
      instruction: "Return JSON last.",
    });
    expect(appendix).toContain("## Response contract");
    expect(appendix).toContain("Return JSON last.");
    expect(appendix).toContain("phase-code");
  });

  test("parseSubagentReturnJson reads last fence", () => {
    const text = 'Done.\n```json\n{"status":"done"}\n```\n';
    expect(parseSubagentReturnJson(text)).toEqual({ status: "done" });
  });
});

describe("resolveHarnessAgentFile", () => {
  test("finds bundled agent when pi dir missing", () => {
    const filePath = resolveHarnessAgentFile("phase-plan");
    expect(filePath).toContain("phase-plan.md");
  });

  test("buildSubagentResponseContract for phase-code", () => {
    const contract = buildSubagentResponseContract("phase-code");
    expect(contract?.format).toBe("json_schema_path");
    if (contract?.format === "json_schema_path") {
      expect(contract.schemaPath).toContain("phase-code.json");
    }
  });
});
