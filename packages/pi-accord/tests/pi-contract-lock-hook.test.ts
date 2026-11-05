import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { HookState } from "../src/hook-state.js";
import { registerPiHarnessHookListeners } from "../src/pi-hook-listeners.js";

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

type Handler = (...args: unknown[]) => unknown;

function fakePi(): { pi: ExtensionAPI; listeners: Map<string, Handler[]> } {
  const listeners = new Map<string, Handler[]>();
  const pi = {
    on: (event: string, handler: Handler) => {
      listeners.set(event, [...(listeners.get(event) ?? []), handler]);
    },
    getAllTools: () => [],
    getActiveTools: () => [],
    setActiveTools() {},
    appendEntry() {},
  } as unknown as ExtensionAPI;
  return { pi, listeners };
}

const roots: string[] = [];
function tmpRoot(withLock: boolean): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lock-hook-")));
  roots.push(root);
  if (withLock) {
    const lockPath = join(root, "docs/dev/HOOK-1/contract.lock.json");
    mkdirSync(dirname(lockPath), { recursive: true });
    writeFileSync(lockPath, "{}");
  }
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function toolCall(root: string, toolName: string, path: string): Promise<unknown[]> {
  const { pi, listeners } = fakePi();
  registerPiHarnessHookListeners(pi, minimalHookState());
  const ctx = { cwd: root, ui: { notify() {}, confirm: async () => true } };
  const results: unknown[] = [];
  for (const handler of listeners.get("tool_call") ?? []) {
    results.push(await handler({ toolName, input: { path, content: "x", edits: [] } }, ctx));
  }
  return results;
}

describe("ASDLC-1/AC-9 pi tool_call lock hook", () => {
  test.each(["write", "edit"])("ASDLC-1/AC-9 %s of locked spec.json is blocked", async (tool) => {
    const root = tmpRoot(true);
    expect(root).not.toBe(process.cwd());
    const results = await toolCall(root, tool, "docs/dev/HOOK-1/spec.json");
    expect(results).toContainEqual({
      block: true,
      reason: expect.stringMatching(/contract-amend/),
    });
  });

  test("ASDLC-1/AC-9 non-locked spec.md passes", async () => {
    const root = tmpRoot(true);
    for (const tool of ["write", "edit"]) {
      const results = await toolCall(root, tool, "docs/dev/HOOK-1/spec.md");
      expect(results.some((r) => (r as { block?: boolean } | undefined)?.block === true)).toBe(
        false,
      );
    }
  });

  test("ASDLC-1/AC-26 without contract.lock.json spec.json passes", async () => {
    const root = tmpRoot(false);
    for (const tool of ["write", "edit"]) {
      const results = await toolCall(root, tool, "docs/dev/HOOK-1/spec.json");
      expect(results.some((r) => (r as { block?: boolean } | undefined)?.block === true)).toBe(
        false,
      );
    }
  });
});
