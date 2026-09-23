/**
 * CLI {@link HarnessLifecycleHost} — stderr notify + non-interactive confirm.
 */

import type { OrchestrationNotifyLevel } from "@clive.shirley/accord-core/orchestration/host.js";
import type { HarnessLifecycleHost } from "@clive.shirley/accord-core/types/harness-lifecycle.js";

export type CliLifecycleHostOptions = {
  notify: (level: OrchestrationNotifyLevel, text: string) => void;
  /** When true, gather preflight auto-confirms missing providers (`-y`). */
  autoConfirm?: boolean;
};

export function createCliLifecycleHost(options: CliLifecycleHostOptions): HarnessLifecycleHost {
  const autoConfirm = options.autoConfirm ?? true;

  return {
    notify(level, text) {
      options.notify(level, text);
    },
    confirm: async () => autoConfirm,
  };
}
