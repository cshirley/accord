/**
 * Load a single agent definition from an absolute `.md` path.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import type { AgentConfig, ModelTier, ThinkingLevel } from "./agents.js";

export type AgentFileSource = "user" | "project" | "explicit";

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

  const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);
  if (!frontmatter.name || !frontmatter.description) {
    return null;
  }

  let tools: string[] | undefined;
  const rawTools = frontmatter.tools;
  if (typeof rawTools === "string") {
    tools = rawTools
      .split(",")
      .map((t: string) => t.trim())
      .filter(Boolean);
  } else if (rawTools && typeof rawTools === "object") {
    tools = Object.entries(rawTools)
      .filter(([, v]) => v === true || v === "true")
      .map(([k]) => k);
  }

  const source: AgentFileSource = options?.source ?? "explicit";
  const piSource: "user" | "project" = source === "project" ? "project" : "user";

  const namespace = options?.namespace;

  return {
    name: frontmatter.name,
    description: frontmatter.description,
    tools: tools && tools.length > 0 ? tools : undefined,
    model: frontmatter.model as string | undefined,
    tier: frontmatter.tier as ModelTier | undefined,
    thinking: frontmatter.thinking as ThinkingLevel | undefined,
    systemPrompt: body,
    source: piSource,
    filePath: resolved,
    namespace,
  };
}
