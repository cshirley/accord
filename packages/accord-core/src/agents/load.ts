/**
 * Load a single agent definition from an absolute `.md` path.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseAgentFrontmatter } from "./frontmatter.js";
import type { AgentConfig, AgentFileSource, ModelTier, ThinkingLevel } from "./types.js";

function parseTools(rawTools: unknown): string[] | undefined {
  if (typeof rawTools === "string") {
    const tools = rawTools
      .split(",")
      .map((tool) => tool.trim())
      .filter(Boolean);
    return tools.length > 0 ? tools : undefined;
  }
  if (rawTools && typeof rawTools === "object" && !Array.isArray(rawTools)) {
    const tools = Object.entries(rawTools)
      .filter(([, value]) => value === true || value === "true")
      .map(([key]) => key);
    return tools.length > 0 ? tools : undefined;
  }
  return undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Load agent config from a markdown file. Returns null when the file is missing,
 * unreadable, or lacks required frontmatter (`name`, `description`).
 */
export function loadAgentFromFile(
  filePath: string,
  options?: { source?: AgentFileSource; namespace?: string },
): AgentConfig | null {
  const resolved = path.resolve(filePath);
  let content: string;
  try {
    content = fs.readFileSync(resolved, "utf-8");
  } catch {
    return null;
  }

  const { frontmatter, body } = parseAgentFrontmatter(content);
  const name = asString(frontmatter.name);
  const description = asString(frontmatter.description);
  if (!name || !description) {
    return null;
  }

  const source: AgentFileSource = options?.source ?? "explicit";
  const piSource: "user" | "project" = source === "project" ? "project" : "user";

  return {
    name,
    description,
    tools: parseTools(frontmatter.tools),
    model: asString(frontmatter.model),
    tier: asString(frontmatter.tier) as ModelTier | undefined,
    thinking: asString(frontmatter.thinking) as ThinkingLevel | undefined,
    systemPrompt: body,
    source: piSource,
    filePath: resolved,
    namespace: options?.namespace,
  };
}
