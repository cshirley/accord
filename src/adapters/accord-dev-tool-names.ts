/**
 * Canonical ordered `dev_*` tool surface shared by the Pi and MCP adapters.
 * `register-tools.ts` and `tools.ts` must register tools in this exact order.
 */

export const ACCORD_DEV_TOOL_NAMES_ORDERED = [
  "dev_intent",
  "dev_intent_enrich",
  "dev_tasks",
  "dev_bootstrap",
  "dev_checkpoint",
  "dev_review_queue",
  "dev_retro",
  "dev_promote_events",
  "dev_spec_gaps",
  "dev_code_brief",
  "dev_quick_fix_brief",
  "dev_resume_state",
  "dev_transition",
  "dev_finalize",
  "dev_verify_summary",
  "dev_nonce",
  "dev_decision_packet",
  "dev_init_detect",
  "dev_init_write",
] as const;

export type AccordDevToolName = (typeof ACCORD_DEV_TOOL_NAMES_ORDERED)[number];

const EXPECTED = [...ACCORD_DEV_TOOL_NAMES_ORDERED];

/** Tool names registered on the MCP server (`mcp.registerTool("dev_*", ...)`) */
export function devToolNamesFromMcpAdapterSource(src: string): string[] {
  return [...src.matchAll(/mcp\.registerTool\(\s*"(dev_[^"]+)"/g)].map((m) => m[1]!);
}

/** Tool names registered for Pi (`pi.registerTool({ ... name: "dev_*", ...)`) */
export function devToolNamesFromPiAdapterSource(src: string): string[] {
  return [...src.matchAll(/pi\.registerTool\(\{\s*name:\s*"(dev_[^"]+)"/g)].map((m) => m[1]!);
}

/** Throws with a clear message if MCP/Pi sources disagree with {@link ACCORD_DEV_TOOL_NAMES_ORDERED}. */
export function assertAccordDevToolSurfaceParity(mcpSrc: string, piSrc: string): void {
  const mcpNames = devToolNamesFromMcpAdapterSource(mcpSrc);
  const piNames = devToolNamesFromPiAdapterSource(piSrc);
  if (new Set(mcpNames).size !== mcpNames.length) {
    throw new Error("MCP adapter: duplicate dev_* tool name in source");
  }
  if (new Set(piNames).size !== piNames.length) {
    throw new Error("Pi adapter: duplicate dev_* tool name in source");
  }
  if (mcpNames.length !== EXPECTED.length) {
    throw new Error(
      `MCP adapter: expected ${EXPECTED.length} dev_* tools, parsed ${mcpNames.length} (update regex or accord-dev-tool-names.ts)`,
    );
  }
  if (piNames.length !== EXPECTED.length) {
    throw new Error(
      `Pi adapter: expected ${EXPECTED.length} dev_* tools, parsed ${piNames.length} (update regex or accord-dev-tool-names.ts)`,
    );
  }
  for (let i = 0; i < EXPECTED.length; i++) {
    const exp = EXPECTED[i]!;
    if (mcpNames[i] !== exp) {
      throw new Error(`MCP adapter dev_* order mismatch at index ${i}: got ${mcpNames[i]}, expected ${exp}`);
    }
    if (piNames[i] !== exp) {
      throw new Error(`Pi adapter dev_* order mismatch at index ${i}: got ${piNames[i]}, expected ${exp}`);
    }
  }
}
