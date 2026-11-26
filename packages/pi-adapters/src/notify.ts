/**
 * Pi adapter for terminal notification. Logic lives in accord-core/notify.
 */

import { isSubagentProcess, terminalNotify } from "@clive.shirley/accord-core/notify/terminal.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function notifyExtension(pi: ExtensionAPI) {
  pi.on("agent_settled", async (_event, ctx) => {
    if (isSubagentProcess() || ctx.mode !== "tui") return;
    terminalNotify("Ready for input");
  });
}
