import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { setSubagentToolRenderers } from "../subagent-tool-renderers.js";
import { createSubagentTool } from "./create-tool.js";

export default function registerSubagentExtension(pi: ExtensionAPI): void {
  const subagentTool = createSubagentTool();
  pi.registerTool(subagentTool);
  setSubagentToolRenderers(
    subagentTool as import("../subagent-tool-renderers.js").SubagentToolRenderers,
  );
}
