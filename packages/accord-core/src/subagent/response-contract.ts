/**
 * Format a {@link SubagentResponseContract} appendix for outbound task text.
 */

import * as fs from "node:fs";
import type { SubagentResponseContract } from "../types/subagent-spawn.js";

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

/** Build full outbound task text with optional response contract appendix. */
export function buildOutboundTaskText(task: string, response?: SubagentResponseContract): string {
  const base = task.trim();
  if (!response) return base;
  return base + formatResponseContractAppendix(response);
}
