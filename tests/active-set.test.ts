import { afterEach, describe, expect, test } from "bun:test";
import {
  ACCORD_CORE_TOOLS,
  ACCORD_TOOL_BUNDLES,
  buildAccordActiveToolNames,
  bundlesForAgentId,
  bundlesForDevSubcommand,
  bundlesForWorkItemPhase,
  bundleForDevTool,
  isDynamicToolsEnabled,
  isManagedAccordTool,
  toolsForBundles,
} from "../src/core/tools/active-set.js";

describe("isDynamicToolsEnabled", () => {
  const original = process.env.ACCORD_DYNAMIC_TOOLS;

  afterEach(() => {
    if (original === undefined) delete process.env.ACCORD_DYNAMIC_TOOLS;
    else process.env.ACCORD_DYNAMIC_TOOLS = original;
  });

  test("defaults to enabled when unset", () => {
    delete process.env.ACCORD_DYNAMIC_TOOLS;
    expect(isDynamicToolsEnabled()).toBe(true);
  });

  test("disabled when ACCORD_DYNAMIC_TOOLS=0", () => {
    process.env.ACCORD_DYNAMIC_TOOLS = "0";
    expect(isDynamicToolsEnabled()).toBe(false);
  });
});

describe("tool bundles", () => {
  test("core tools are always included", () => {
    const names = toolsForBundles(new Set());
    for (const tool of ACCORD_CORE_TOOLS) {
      expect(names).toContain(tool);
    }
  });

  test("spec bundle adds checkpoint and spec_gaps", () => {
    const names = toolsForBundles(new Set(["spec"]));
    expect(names).toContain("dev_checkpoint");
    expect(names).toContain("dev_spec_gaps");
    expect(names).not.toContain("dev_code_brief");
  });

  test("bundlesForAgentId maps phase-code to code bundle", () => {
    expect(bundlesForAgentId("phase-code")).toEqual(["code"]);
  });

  test("bundlesForDevSubcommand maps finish to meta and code", () => {
    expect(bundlesForDevSubcommand("finish")).toEqual(["meta", "code"]);
  });

  test("bundlesForWorkItemPhase maps implementing to code", () => {
    expect(bundlesForWorkItemPhase("implementing")).toEqual(["code"]);
  });

  test("bundleForDevTool resolves bundle membership", () => {
    expect(bundleForDevTool("dev_retro")).toBe("meta");
    expect(bundleForDevTool("dev_intent")).toBeNull();
  });

  test("buildAccordActiveToolNames preserves non-managed tools", () => {
    const active = buildAccordActiveToolNames(new Set(), ["read", "bash", "dev_retro"]);
    expect(active).toContain("read");
    expect(active).toContain("bash");
    expect(active).not.toContain("dev_retro");
    expect(active).toContain("dev_intent");
  });

  test("isManagedAccordTool covers dev_* and subagent", () => {
    expect(isManagedAccordTool("dev_tasks")).toBe(true);
    expect(isManagedAccordTool("subagent")).toBe(true);
    expect(isManagedAccordTool("read")).toBe(false);
  });

  test("every bundle tool is either core or listed in a bundle", () => {
    const covered = new Set<string>([...ACCORD_CORE_TOOLS, ...Object.values(ACCORD_TOOL_BUNDLES).flat()]);
    // All bundle definitions reference valid names (smoke).
    expect(covered.size).toBeGreaterThan(ACCORD_CORE_TOOLS.length);
  });
});
