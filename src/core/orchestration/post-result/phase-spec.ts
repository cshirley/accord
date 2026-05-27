/**
 * After validated **phase-spec** return with status `done` — verify spec.json on disk,
 * regenerate spec.md, record the path on the work item, and advance coarse phase to `planning`.
 */

import { syncSpecMarkdownFromJson } from "../../artifacts/spec-markdown.js";
import { workItemUsesAlignFirstPipeline } from "../../subagent/preflight/pipeline-artifacts.js";
import {
  artifactLooksComplete,
  artifactPathForWorkItem,
  preferredDevArtifactRelPath,
  resolveDevArtifactPathForId,
} from "../../work-items/artifact-discovery.js";
import { loadWorkItem } from "../../work-items/io.js";
import { devTransition } from "../../work-items/lifecycle.js";

interface PhaseSpecDonePacket {
  status: "done";
  spec_path?: string;
}

function isPhaseSpecDonePacket(packet: unknown): packet is PhaseSpecDonePacket {
  return (
    !!packet && typeof packet === "object" && (packet as PhaseSpecDonePacket).status === "done"
  );
}

export function applyPhaseSpecPostResult(workItemId: string, packet: unknown): string {
  if (!isPhaseSpecDonePacket(packet)) {
    return "";
  }

  const wi = loadWorkItem(workItemId);
  if (!wi || !workItemUsesAlignFirstPipeline(wi)) {
    return "";
  }

  const declaredPath = packet.spec_path?.trim();
  const resolvedPath = resolveDevArtifactPathForId(workItemId, "spec");
  const expectedRel = preferredDevArtifactRelPath(workItemId, "spec");

  if (!artifactLooksComplete("spec", resolvedPath, workItemId)) {
    return [
      "",
      "❌ **phase-spec returned `done` but no complete spec is on disk.**",
      "",
      `- Checked: \`${resolvedPath}\``,
      declaredPath && declaredPath !== resolvedPath
        ? `- Packet spec_path: \`${declaredPath}\``
        : "",
      "",
      `Respawn **phase-spec** (or \`/dev resume ${workItemId}\`) until it writes \`${expectedRel}\`.`,
      "**phase-plan is blocked** until the spec exists.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  const pathToRecord = artifactPathForWorkItem(
    workItemId,
    "spec",
    declaredPath && artifactLooksComplete("spec", declaredPath, workItemId)
      ? declaredPath
      : resolvedPath,
  );

  const mdSync = syncSpecMarkdownFromJson(resolvedPath);
  const specMdNote = mdSync.ok
    ? ` Human-readable view at \`${mdSync.value.specMdPath}\`.`
    : ` ⚠ Could not generate spec.md: ${mdSync.error}`;

  const transition = devTransition(workItemId, "planning", { spec: pathToRecord });
  if (!transition.ok) {
    return `\n\n⚠ **Spec found** at \`${pathToRecord}\` but transition to planning failed: ${transition.error}\n`;
  }

  return [
    "",
    `✓ **Spec recorded** at \`${pathToRecord}\`.${specMdNote} Work item advanced to **planning**.`,
    "",
    `Next: \`/dev plan ${workItemId}\` or \`/dev resume ${workItemId}\`.`,
  ].join("\n");
}
