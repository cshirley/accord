import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerPiHarnessHookListeners } from "../src/adapters/pi/pi-hook-listeners.js";
import type { HookState } from "../src/adapters/pi/hook-state.js";

function minimalHookState(): HookState {
  return {
    devConfig: null,
    sessionCost: 0,
    activeWorkItem: null,
    _harnessSessionMarkerFp: null,
    costCache: new Map(),
  };
}

function capturePiHooks(): {
  pi: ExtensionAPI;
  handlers: Map<string, (...args: unknown[]) => unknown>;
} {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const pi = {
    on: (event: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(event, handler);
    },
    getAllTools: () => [],
    appendEntry: () => {},
  } as unknown as ExtensionAPI;
  return { pi, handlers };
}

describe("registerPiHarnessHookListeners — agent_settled", () => {
  test("registers agent_settled for end-of-run side effects, not agent_end", () => {
    const { pi, handlers } = capturePiHooks();
    registerPiHarnessHookListeners(pi, minimalHookState());

    expect(handlers.has("agent_settled")).toBe(true);
    expect(handlers.has("agent_end")).toBe(false);
  });

  test("registers session_info_changed to re-sync harness marker", () => {
    const { pi, handlers } = capturePiHooks();
    registerPiHarnessHookListeners(pi, minimalHookState());

    expect(handlers.has("session_info_changed")).toBe(true);
  });
});
