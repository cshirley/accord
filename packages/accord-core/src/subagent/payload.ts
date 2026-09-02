/**
 * Enrich Pi `subagent` tool payloads with agent paths and response contracts.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { agentSchemas } from "../agents/registry.js";
import { formatIntentContractForTask } from "../briefing/intent-contract-brief.js";
import type { DevHarnessConfig } from "../config/index.js";
import { CORE_DIR, EXT_DIR, PI_AGENT_DIR } from "../config/paths.js";
import type { SubagentResponseContract } from "../types/subagent-spawn.js";
import { formatConfigBrief } from "../verification/runner.js";
import { collectSubagentEntries } from "./entries.js";

const SCHEMAS_DIR = join(CORE_DIR, "schemas");

const RETURN_JSON_INSTRUCTION =
  "Emit exactly one fenced ```json block as the last content in your response, matching the return schema below.";

function readSchemaFile(absolutePath: string): string {
  try {
    return readFileSync(absolutePath, "utf-8").trim();
  } catch {
    return "";
  }
}

function resolveInstalledAgentFile(agentName: string): string | null {
  const candidates = [
    join(PI_AGENT_DIR, "agents", "accord", `${agentName}.md`),
    join(EXT_DIR, "assets", "agents", "accord", `${agentName}.md`),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Absolute path to agent markdown when installed or bundled. */
export function resolveHarnessAgentFile(agentName: string): string | null {
  if (!agentName) return null;
  return resolveInstalledAgentFile(agentName);
}

export function buildSubagentResponseContract(
  agentName: string,
): SubagentResponseContract | undefined {
  const paths = agentSchemas(agentName);
  if (paths.length === 0) return undefined;

  const returnPath = paths.find((rel) => rel.includes("return-schemas/"));
  if (returnPath) {
    const schemaPath = join(SCHEMAS_DIR, returnPath);
    if (!existsSync(schemaPath)) return undefined;
    const examplesRel = returnPath.replace("return-schemas/", "examples/");
    const examplesPath = join(SCHEMAS_DIR, examplesRel);
    return {
      format: "json_schema_path",
      schemaPath,
      examplesPath: existsSync(examplesPath) ? examplesPath : undefined,
      instruction: RETURN_JSON_INSTRUCTION,
    };
  }

  const sections: string[] = [];
  for (const rel of paths) {
    const absolute = join(SCHEMAS_DIR, rel);
    const content = readSchemaFile(absolute);
    if (!content) continue;
    const title = rel.replace(".json", "");
    sections.push(`### ${title}`, "", "```json", content, "```", "");
  }

  if (sections.length === 0) return undefined;
  return {
    format: "markdown_section",
    title: "Schemas",
    body: sections.join("\n"),
  };
}

export type SubagentSpawnPayload = {
  agentFile?: string;
  systemAppend?: string;
  response?: SubagentResponseContract;
};

export function buildSubagentSpawnPayload(
  agentName: string,
  task: string,
  devConfig: DevHarnessConfig | null,
): SubagentSpawnPayload {
  const systemParts: string[] = [];
  if (devConfig) {
    systemParts.push(formatConfigBrief(devConfig).trim());
  }
  const intent = formatIntentContractForTask(task);
  if (intent.trim()) {
    systemParts.push(intent.trim());
  }

  return {
    agentFile: resolveHarnessAgentFile(agentName) ?? undefined,
    systemAppend: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    response: buildSubagentResponseContract(agentName),
  };
}

/** Apply spawn payload fields onto a subagent tool-call input object. */
export function applySubagentSpawnPayload(
  input: Record<string, unknown>,
  devConfig: DevHarnessConfig | null,
): void {
  const entries = collectSubagentEntries(input);

  for (const entry of entries) {
    const agentName = entry.agent ?? "";
    if (!agentName) continue;

    const payload = buildSubagentSpawnPayload(agentName, entry.task ?? "", devConfig);
    if (payload.agentFile) {
      if (!input.agentFile) input.agentFile = payload.agentFile;
      entry.agentFile = payload.agentFile;
    }
    if (payload.systemAppend) {
      const existing = typeof input.systemAppend === "string" ? input.systemAppend : "";
      const merged = existing ? `${existing}\n\n${payload.systemAppend}` : payload.systemAppend;
      input.systemAppend = merged;
    }
    if (payload.response && !input.response) {
      input.response = payload.response;
    }
  }
}
