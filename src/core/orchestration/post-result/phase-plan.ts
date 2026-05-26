/**
 * After validated **phase-plan** return with status `done` — verify plan.json on disk,
 * record the path, bootstrap task files, and advance coarse phase to `implementing`.
 */

import { workItemUsesAlignFirstPipeline } from "../../subagent/preflight/pipeline-artifacts.js";
import {
  artifactLooksComplete,
  artifactPathForWorkItem,
  bootstrapImplementTasksFromPlan,
  preferredDevArtifactRelPath,
  resolveDevArtifactPathForId,
} from "../../work-items/artifact-discovery.js";
import { loadWorkItem } from "../../work-items/io.js";
import { devTransition } from "../../work-items/lifecycle.js";

interface PhasePlanDonePacket {
  status: "done";
  plan_path?: string;
}

function isPhasePlanDonePacket(packet: unknown): packet is PhasePlanDonePacket {
  return (
    !!packet &&
    typeof packet === "object" &&
    (packet as PhasePlanDonePacket).status === "done"
  );
}

export function applyPhasePlanPostResult(workItemId: string, packet: unknown): string {
  if (!isPhasePlanDonePacket(packet)) {
    return "";
  }

  const wi = loadWorkItem(workItemId);
  if (!wi || !workItemUsesAlignFirstPipeline(wi)) {
    return "";
  }

  const declaredPath = packet.plan_path?.trim();
  const resolvedPath = resolveDevArtifactPathForId(workItemId, "plan");
  const expectedRel = preferredDevArtifactRelPath(workItemId, "plan");

  if (!artifactLooksComplete("plan", resolvedPath, workItemId)) {
    return [
      "",
      "❌ **phase-plan returned `done` but no complete plan is on disk.**",
      "",
      `- Checked: \`${resolvedPath}\``,
      declaredPath && declaredPath !== resolvedPath ? `- Packet plan_path: \`${declaredPath}\`` : "",
      "",
      `Respawn **phase-plan** (or \`/dev resume ${workItemId}\`) until it writes \`${expectedRel}\`.`,
    ]
      .filter(Boolean)
      .join("\n");
  }

  const pathToRecord = artifactPathForWorkItem(
    workItemId,
    "plan",
    declaredPath && artifactLooksComplete("plan", declaredPath, workItemId)
      ? declaredPath
      : resolvedPath,
  );

  const transition = devTransition(workItemId, "implementing", { plan: pathToRecord });
  if (!transition.ok) {
    return `\n\n⚠ **Plan found** at \`${pathToRecord}\` but transition to implementing failed: ${transition.error}\n`;
  }

  const bootstrapped = bootstrapImplementTasksFromPlan(workItemId, resolvedPath);
  const taskNote =
    bootstrapped > 0 ? ` Bootstrapped ${String(bootstrapped)} task file(s).` : "";

  return [
    "",
    `✓ **Plan recorded** at \`${pathToRecord}\`. Work item advanced to **implementing**.${taskNote}`,
    "",
    `Next: \`/dev resume ${workItemId}\` for the first implementation task.`,
  ].join("\n");
}
