/**
 * Turn a {@link SubagentResponseContract} into task appendices.
 */

import * as fs from "node:fs";
import type { SubagentResponseContract } from "./spawn/types.js";

function readOptionalFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8").trim();
  } catch {
    return "";
  }
}

/** Append response instructions and schema bodies to the outbound task string. */
export function formatResponseContractAppendix(contract: SubagentResponseContract): string {
  const lines: string[] = ["", "## Response contract", ""];

  switch (contract.format) {
    case "instruction":
      lines.push(contract.instruction.trim());
      break;

    case "markdown_section":
      lines.push(`### ${contract.title}`, "", contract.body.trim());
      break;

    case "json_schema_path": {
      if (contract.instruction) {
        lines.push(contract.instruction.trim(), "");
      }
      const schema = readOptionalFile(contract.schemaPath);
      if (schema) {
        const label = contract.schemaPath.split(/[/\\]/).pop()?.replace(".json", "") ?? "schema";
        lines.push(`### return: ${label}`, "", "```json", schema, "```", "");
      }
      if (contract.examplesPath) {
        const examples = readOptionalFile(contract.examplesPath);
        if (examples) {
          lines.push("### Examples", "", "```json", examples, "```", "");
        }
      }
      break;
    }

    case "json_schema": {
      if (contract.instruction) {
        lines.push(contract.instruction.trim(), "");
      }
      const label = contract.label ?? "response";
      lines.push(
        `### return: ${label}`,
        "",
        "```json",
        JSON.stringify(contract.schema, null, 2),
        "```",
        "",
      );
      if (contract.examples !== undefined) {
        lines.push(
          "### Examples",
          "",
          "```json",
          JSON.stringify(contract.examples, null, 2),
          "```",
          "",
        );
      }
      break;
    }
  }

  return lines.join("\n");
}

/** Extract the last ```json fenced block from assistant text. */
export function parseSubagentReturnJson(text: string): unknown | undefined {
  const pattern = /```json\s*([\s\S]*?)```/gi;
  let match: RegExpExecArray | null = null;
  let lastBody: string | undefined;
  while (true) {
    match = pattern.exec(text);
    if (!match) break;
    lastBody = match[1];
  }
  if (!lastBody?.trim()) return undefined;
  try {
    return JSON.parse(lastBody.trim()) as unknown;
  } catch {
    return undefined;
  }
}
