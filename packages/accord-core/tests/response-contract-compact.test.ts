import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  compactJsonText,
  formatResponseContractAppendix,
} from "../src/agents/response-contract.js";
import { buildSubagentResponseContract } from "../src/subagent/payload.js";
import { buildOutboundTaskText } from "../src/subagent/response-contract.js";
import { formatSchemaBrief } from "../src/verification/runner.js";

const SCHEMAS = path.resolve(import.meta.dir, "../schemas");
const minified = (rel: string): string =>
  JSON.stringify(JSON.parse(fs.readFileSync(path.join(SCHEMAS, rel), "utf8")));
/** Any pretty-printed JSON line: newline followed by indentation and a quoted key. */
const PRETTY = /\n {2,}"/;

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

describe("response contract schema injection is minified on every path", () => {
  const contract = buildSubagentResponseContract("phase-test");
  if (!contract) throw new Error("no contract");

  test.each([
    ["pi appendix", () => formatResponseContractAppendix(contract)],
    ["exec outbound task", () => buildOutboundTaskText("task", contract)],
    ["schema brief", () => formatSchemaBrief("phase-test")],
  ])("%s carries minified schema and examples", (_label, render) => {
    const text = render();
    expect(text).toContain(minified("return-schemas/phase-test.json"));
    expect(text).toContain(minified("examples/phase-test.json"));
    expect(text).not.toMatch(PRETTY);
  });

  test("json_schema contracts are minified on pi and exec paths", () => {
    const inline = {
      format: "json_schema" as const,
      schema: { a: { b: 1 } },
      examples: [{ x: 1 }],
    };
    for (const text of [
      formatResponseContractAppendix(inline),
      buildOutboundTaskText("t", inline),
    ]) {
      expect(text).toContain('{"a":{"b":1}}');
      expect(text).toContain('[{"x":1}]');
      expect(text).not.toMatch(PRETTY);
    }
  });
});
