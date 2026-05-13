import type { OrchestrationContext } from "./types.js";

export const orchestrationGuardRegistry: Record<string, (ctx: OrchestrationContext) => boolean> = {
  always_true: () => true,
  always_false: () => false,
};
