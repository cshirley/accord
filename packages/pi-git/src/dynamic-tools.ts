/**
 * Progressive discovery for pi-git — inactive git/gh/wt tools + search_accord_tools loader.
 */

import {
  buildLoaderActiveSet,
  getRegisteredSearchableToolNames,
  isProgressiveToolsEnabled,
  registerSearchableTools,
  notifyToolsMatched,
  scoreToolCatalog,
  SEARCH_ACCORD_TOOLS,
} from "@clive.shirley/accord-core/tools/progressive-discovery.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  type GitToolBundle,
  gitBundleForTool,
  gitToolsForBundles,
  GIT_MANAGED_TOOL_NAMES,
  isGitManagedTool,
} from "./tool-bundles.js";

const PACKAGE_ENV = "PI_GIT_DYNAMIC_TOOLS";

let searchToolRegistered = false;
let activatedBundles = new Set<GitToolBundle>();

export function resetGitToolBundles(): void {
  activatedBundles = new Set();
}

export function activateGitBundles(bundles: GitToolBundle[]): void {
  for (const bundle of bundles) activatedBundles.add(bundle);
}

function gitDynamicEnabled(): boolean {
  return isProgressiveToolsEnabled(PACKAGE_ENV);
}

function managedGitSet(): Set<string> {
  return new Set(GIT_MANAGED_TOOL_NAMES);
}

export function applyGitActiveTools(pi: ExtensionAPI): void {
  if (!gitDynamicEnabled()) return;

  const preserved = pi.getActiveTools();
  const names = new Set<string>();
  for (const tool of preserved) {
    if (!isGitManagedTool(tool)) names.add(tool);
  }
  for (const tool of gitToolsForBundles(activatedBundles)) {
    names.add(tool);
  }
  names.add(SEARCH_ACCORD_TOOLS);
  pi.setActiveTools([...names]);
}

export function applyGitSessionStartActiveSet(pi: ExtensionAPI): void {
  if (!gitDynamicEnabled()) return;
  pi.setActiveTools(buildLoaderActiveSet(pi.getActiveTools(), managedGitSet()));
}

export function maybeActivateGitToolCall(pi: ExtensionAPI, toolName: string): boolean {
  if (!gitDynamicEnabled() || !isGitManagedTool(toolName)) return false;
  const bundle = gitBundleForTool(toolName);
  if (!bundle || activatedBundles.has(bundle)) return false;
  activateGitBundles([bundle]);
  applyGitActiveTools(pi);
  return true;
}

function ensureSearchTool(pi: ExtensionAPI): void {
  if (searchToolRegistered) return;
  // Action methods (getAllTools) are unavailable during extension load (pi-coding-agent 0.85+).

  pi.registerTool({
    name: SEARCH_ACCORD_TOOLS,
    label: "Search Accord Tools",
    description: "Search for and enable pi-git / pi-integrations tools by task keywords",
    promptSnippet: "Load additional Accord extension tools when the active set cannot perform the task",
    promptGuidelines: [
      "Call search_accord_tools when you need git, PR, worktree, review, harness, Jira, Slack, or Gmail tools that are not currently active.",
      "Prefer search_accord_tools over guessing inactive tool names.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Capability or task to search for (e.g. 'merge PR', 'worktree', 'jira')" }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 12 })),
    }),
    async execute(_toolCallId, params) {
      const searchable = getRegisteredSearchableToolNames();
      const limit = params.limit ?? 5;
      const matches = scoreToolCatalog(pi.getAllTools(), searchable, params.query, limit);

      if (matches.length === 0) {
        return {
          content: [{ type: "text", text: `No tools found for: ${params.query}` }],
          details: { matches: [] as string[], added: [] as string[] },
        };
      }

      for (const name of matches) {
        const bundle = gitBundleForTool(name);
        if (bundle) activateGitBundles([bundle]);
      }
      notifyToolsMatched(matches);

      const activeBefore = new Set(pi.getActiveTools());
      applyGitActiveTools(pi);
      const activeAfter = pi.getActiveTools();
      const added = activeAfter.filter((name) => !activeBefore.has(name));

      return {
        content: [
          {
            type: "text",
            text:
              added.length > 0
                ? `Loaded tools: ${added.join(", ")}`
                : `Matching tools already active: ${matches.join(", ")}`,
          },
        ],
        details: { matches, added },
      };
    },
  });

  searchToolRegistered = true;
}

export function initGitDynamicTools(pi: ExtensionAPI): void {
  registerSearchableTools(GIT_MANAGED_TOOL_NAMES);
  ensureSearchTool(pi);

  pi.on("session_start", () => {
    resetGitToolBundles();
    applyGitSessionStartActiveSet(pi);
  });

  pi.on("tool_call", async (event) => {
    maybeActivateGitToolCall(pi, event.toolName);
  });
}
