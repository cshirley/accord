import { rmSync } from "node:fs";
import { join } from "node:path";
import { type AccordTrailer, buildCommitMessage } from "../commit/commit-grammar.js";
import { devArtifactDirRel } from "../work-items/artifact-discovery.js";
import { writeJson } from "../work-items/io.js";

export interface CloseoutPreparation {
  /** Commit message with the Accord `outcome=closeout` trailer. */
  message: string;
  trailer: AccordTrailer;
  /** Repo-relative path of the in-tree closeout marker. */
  markerRel: string;
}

/**
 * Closeout pre-stage step. Call only after trace.*, verify.* and workflow-cost.* are built:
 * writes the squash-proof marker `evidence/closeout.json`, then removes `docs/dev/<ID>/state/`
 * so the removal lands in the same commit.
 */
export function prepareCloseout(workItemId: string, root: string): CloseoutPreparation {
  const devRel = devArtifactDirRel(workItemId);
  const markerRel = `${devRel}/evidence/closeout.json`;
  const trailer: AccordTrailer = {
    v: 1,
    id: workItemId,
    task: 0,
    seq: 0,
    ref: "V0/closeout",
    agent: "closeout",
    loop: "V",
    round: 0,
    outcome: "closeout",
  };
  writeJson(join(root, markerRel), {
    work_item_id: workItemId,
    outcome: "closeout",
    closed_at: new Date().toISOString(),
  });
  rmSync(join(root, devRel, "state"), { recursive: true, force: true });
  const message = buildCommitMessage({
    summary: "Closeout: verify report, implementation trace, workflow cost, state removed",
    trailer,
  });
  return { message, trailer, markerRel };
}
