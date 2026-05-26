/**
 * After validated **phase-align** return with status `done` — verify brief.md on disk,
 * record the path on the work item, and advance coarse phase to `speccing`.
 */

import { workItemUsesAlignFirstPipeline } from "../../subagent/preflight/pipeline-artifacts.js";
import {
  artifactLooksComplete,
  artifactPathForWorkItem,
  preferredDevArtifactRelPath,
  resolveDevArtifactPathForId,
} from "../../work-items/artifact-discovery.js";
import { loadWorkItem } from "../../work-items/io.js";
import { devTransition } from "../../work-items/lifecycle.js";

interface PhaseAlignDonePacket {
  status: "done";
  brief_path?: string;
}

function isPhaseAlignDonePacket(packet: unknown): packet is PhaseAlignDonePacket {
  return (
    !!packet &&
    typeof packet === "object" &&
    (packet as PhaseAlignDonePacket).status === "done"
  );
}

/**
 * @returns Markdown to append for the orchestrator (empty when this path does not apply).
 */
export function applyPhaseAlignPostResult(workItemId: string, packet: unknown): string {
  if (!isPhaseAlignDonePacket(packet)) {
    return "";
  }

  const wi = loadWorkItem(workItemId);
  if (!wi || !workItemUsesAlignFirstPipeline(wi)) {
    return "";
  }

  const declaredPath = packet.brief_path?.trim();
  const resolvedPath = resolveDevArtifactPathForId(workItemId, "brief");
  const expectedRel = preferredDevArtifactRelPath(workItemId, "brief");

  if (!artifactLooksComplete("brief", resolvedPath, workItemId)) {
    return [
      "",
      "❌ **phase-align returned `done` but no complete brief is on disk.**",
      "",
      `- Checked: \`${resolvedPath}\``,
      declaredPath && declaredPath !== resolvedPath ? `- Packet brief_path: \`${declaredPath}\`` : "",
      "",
      `Respawn **phase-align** (or \`/dev align ${workItemId}\`) until it writes \`${expectedRel}\`.`,
      "**phase-spec is blocked** until the brief exists.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  const pathToRecord = artifactPathForWorkItem(
    workItemId,
    "brief",
    declaredPath && artifactLooksComplete("brief", declaredPath, workItemId)
      ? declaredPath
      : resolvedPath,
  );

  const transition = devTransition(workItemId, "speccing", { brief: pathToRecord });
  if (!transition.ok) {
    return `\n\n⚠ **Brief found** at \`${pathToRecord}\` but transition to speccing failed: ${transition.error}\n`;
  }

  return [
    "",
    `✓ **Brief recorded** at \`${pathToRecord}\`. Work item advanced to **speccing**.`,
    "",
    `Next: \`/dev spec ${workItemId}\` or \`/dev resume ${workItemId}\`.`,
  ].join("\n");
}
