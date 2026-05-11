/**
 * Event hooks — Pi lifecycle → `core/harness` (host-neutral) + Pi UI wiring.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerPiHarnessHookListeners } from "./pi-hook-listeners.js";
import type { HookState } from "./hook-state.js";

export { syncHarnessRunSessionEntry } from "./hook-state.js";
export type { HookState } from "./hook-state.js";

export function registerHooks(pi: ExtensionAPI, state: HookState): void {
  registerPiHarnessHookListeners(pi, state);
}
