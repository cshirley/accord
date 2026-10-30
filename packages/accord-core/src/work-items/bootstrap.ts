/**
 * Create a work item from a title (ticket-keyed or ad-hoc with a synthetic id).
 *
 * Host-neutral: the `accord bootstrap` command and any other adapter call this and only format
 * the result. Validation, id allocation and the existence guard live here.
 */

import fs from "node:fs";
import path from "node:path";
import type { WorkItemPattern, WorkItemVariant } from "../types/domain.js";
import { err, ok, type Result } from "../types/result.js";
import { devArtifactDir } from "./artifact-discovery.js";
import { loadWorkItem, WORK_ITEM_ID_EXACT } from "./io.js";
import { devBootstrap, entryPhaseFor } from "./lifecycle.js";
import { nextSyntheticWorkItemId } from "./synthetic.js";
import { workItemJsonPath } from "./tasks-dir.js";
import type { WorkItem } from "./types.js";

export const WORK_ITEM_PATTERNS = [
  "implement",
  "quick_fix",
  "investigate",
  "infra",
  "analyse",
] as const satisfies readonly WorkItemPattern[];

export const WORK_ITEM_VARIANTS = [
  "express",
  "standard",
  "orchestrated",
] as const satisfies readonly WorkItemVariant[];

/** Entry phases whose resume agent is `phase-gather`, which fetches a tracker ticket. */
const TRACKER_ENTRY_PHASES = new Set(["gathering", "researching"]);

export interface BootstrapWorkItemInput {
  /** Explicit id (for example `STEP-123`). Omit with `adhoc` to allocate `ADHOC-<YYYYMMDD><NN>`. */
  id?: string;
  adhoc?: boolean;
  title: string;
  pattern: string;
  variant: string;
  /** Injected clock for id allocation (tests). */
  now?: Date;
}

export interface BootstrapWorkItemOutput {
  id: string;
  path: string;
  work_item: WorkItem;
  /** The command that continues the work item, chosen from its entry phase. */
  next: string;
}

/**
 * Atomically claim `id` by creating its work item file exclusively. Two concurrent callers can
 * therefore never both succeed for the same id. Returns false when the id is already taken.
 */
function claimWorkItemId(id: string): boolean {
  if (loadWorkItem(id) !== null || fs.existsSync(devArtifactDir(id))) return false;
  const file = workItemJsonPath(id);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, "", { flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

export function bootstrapWorkItem(input: BootstrapWorkItemInput): Result<BootstrapWorkItemOutput> {
  const title = input.title.trim();
  if (!title) return err("bootstrap requires a title");
  if (WORK_ITEM_ID_EXACT.test(title)) {
    return err(
      "bootstrap: title must describe the work, not be a ticket id. A ticket-shaped title makes align look it up in the tracker.",
    );
  }
  if (!(WORK_ITEM_PATTERNS as readonly string[]).includes(input.pattern)) {
    return err(`--pattern must be one of: ${WORK_ITEM_PATTERNS.join(", ")}`);
  }
  if (!(WORK_ITEM_VARIANTS as readonly string[]).includes(input.variant)) {
    return err(`--variant must be one of: ${WORK_ITEM_VARIANTS.join(", ")}`);
  }
  const pattern = input.pattern as WorkItemPattern;

  if (input.adhoc) {
    if (input.id) return err("bootstrap --adhoc generates the id; do not pass one");
    const entry = entryPhaseFor(pattern, input.variant);
    if (TRACKER_ENTRY_PHASES.has(entry)) {
      return err(
        `--adhoc cannot start a ${pattern} work item: it begins by fetching tracker ticket context (phase ${entry}), and an ad-hoc id has no ticket. Use a real ticket id: bootstrap <ID> <title>.`,
      );
    }
  } else if (!input.id || !WORK_ITEM_ID_EXACT.test(input.id)) {
    return err(`bootstrap: "${input.id ?? ""}" is not a work item id (expected e.g. ACCORD-1234).`);
  }

  let id: string;
  try {
    id = input.adhoc
      ? nextSyntheticWorkItemId((candidate) => !claimWorkItemId(candidate), input.now)
      : (input.id as string);
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
  if (!input.adhoc && !claimWorkItemId(id)) {
    return err(`bootstrap: work item ${id} already exists. Use: accord resume ${id}`);
  }

  let boot: ReturnType<typeof devBootstrap>;
  try {
    boot = devBootstrap(id, title, pattern, input.variant, {
      expected_finish: title.slice(0, 240),
    });
  } catch (error) {
    // Release the claim so a failed bootstrap does not leave an empty placeholder behind.
    fs.rmSync(workItemJsonPath(id), { force: true });
    return err(error instanceof Error ? error.message : String(error));
  }

  const next = boot.work_item.phase === "aligning" ? `accord align ${id}` : `accord resume ${id}`;
  return ok({ id, path: boot.path, work_item: boot.work_item, next });
}
