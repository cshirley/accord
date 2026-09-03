import { afterEach, describe, expect, test } from "bun:test";
import { ACCORD_CORE_TOOLS } from "@clive.shirley/accord-core/tools/active-set.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  applyAccordActiveTools,
  inactiveRegisteredDevTools,
  maybeActivateDevToolCall,
  resetDynamicToolBundles,
} from "../src/adapters/pi/dynamic-tools.js";
import type { HookState } from "../src/adapters/pi/hook-state.js";

function minimalHookState(): HookState {
  return {
    devConfig: null,
    sessionCost: 0,
    activeWorkItem: null,
    _harnessSessionMarkerFp: null,
    costCache: new Map(),
    activatedToolBundles: new Set(),
  };
}

function mockPi(initialActive: string[] = ["read", "bash", "edit", "write"]): {
  pi: ExtensionAPI;
  active: string[];
} {
  const active = [...initialActive];
  const pi = {
    getActiveTools: () => [...active],
    setActiveTools: (names: string[]) => {
      active.length = 0;
      active.push(...names);
    },
  } as unknown as ExtensionAPI;
  return { pi, active };
}

describe("applyAccordActiveTools", () => {
  const original = process.env.ACCORD_DYNAMIC_TOOLS;

  afterEach(() => {
    if (original === undefined) delete process.env.ACCORD_DYNAMIC_TOOLS;
    else process.env.ACCORD_DYNAMIC_TOOLS = original;
  });

  test("session start leaves inactive dev_* out of active set", () => {
    process.env.ACCORD_DYNAMIC_TOOLS = "1";
    const state = minimalHookState();
    const { pi, active } = mockPi(["read", "bash", "dev_checkpoint"]);

    resetDynamicToolBundles(state);
    applyAccordActiveTools(pi, state);

    expect(active).toContain("read");
    expect(active).toContain("bash");
    for (const tool of ACCORD_CORE_TOOLS) {
      expect(active).toContain(tool);
    }
    expect(active).not.toContain("dev_checkpoint");
    expect(active).not.toContain("dev_retro");
    expect(inactiveRegisteredDevTools(pi).length).toBeGreaterThan(0);
  });

  test("does nothing when ACCORD_DYNAMIC_TOOLS=0", () => {
    process.env.ACCORD_DYNAMIC_TOOLS = "0";
    const state = minimalHookState();
    const { pi, active } = mockPi(["read", "dev_retro"]);

    applyAccordActiveTools(pi, state);

    expect(active).toEqual(["read", "dev_retro"]);
  });

  test("maybeActivateDevToolCall expands bundle on demand", () => {
    process.env.ACCORD_DYNAMIC_TOOLS = "1";
    const state = minimalHookState();
    const { pi, active } = mockPi(["read", "bash"]);

    resetDynamicToolBundles(state);
    applyAccordActiveTools(pi, state);
    expect(active).not.toContain("dev_retro");

    const activated = maybeActivateDevToolCall(pi, state, "dev_retro");
    expect(activated).toBe(true);
    expect(active).toContain("dev_retro");
  });
});
