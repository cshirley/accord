import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  compactJsonText,
  formatResponseContractAppendix,
} from "../src/agents/response-contract.js";
import { buildSubagentResponseContract } from "../src/subagent/payload.js";

const SCHEMA = path.resolve(import.meta.dir, "../schemas/return-schemas/phase-test.json");

describe("compactJsonText", () => {
  test("minifies valid JSON without changing its value", () => {
    const pretty = '{\n  "a": [1, 2],\n  "b": { "c": "x y" }\n}\n';
    expect(compactJsonText(pretty)).toBe('{"a":[1,2],"b":{"c":"x y"}}');
  });

  test("returns trimmed text unchanged when input is not JSON", () => {
    expect(compactJsonText("  not json  ")).toBe("not json");
    expect(compactJsonText("")).toBe("");
  });
});

describe("response contract schema injection", () => {
  test("injects return schema and examples minified", () => {
    const contract = buildSubagentResponseContract("phase-test");
    expect(contract?.format).toBe("json_schema_path");
    if (!contract) throw new Error("no contract");
    const appendix = formatResponseContractAppendix(contract);
    const original = fs.readFileSync(SCHEMA, "utf8");
    expect(appendix).toContain(JSON.stringify(JSON.parse(original)));
    expect(appendix).not.toContain('{\n  "');
    expect(appendix.length).toBeLessThan(original.length);
  });
});
