/**
 * Create a work item from a title (ticket-keyed or ad-hoc with a synthetic id).
 *
 * Host-neutral: the `accord bootstrap` command and any other adapter call this and only format
 * the result. Validation, id allocation and the existence guard live here.
 */

import fs from "node:fs";
import path from "node:path";
import { DEV_WORK_ITEM_ID_PATTERN } from "../commands/dispatch.js";
import { resolveResumeAgentId } from "../orchestration/phase-coarse-routing.js";
import type { WorkItemPattern, WorkItemVariant } from "../types/domain.js";
import { err, ok, type Result } from "../types/result.js";
import { devArtifactDir } from "./artifact-discovery.js";
import { loadWorkItem } from "./io.js";
import { buildBootstrapWorkItem, entryPhaseFor } from "./lifecycle.js";
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

/** True when an id is already used by a work item (anywhere it is looked up) or a docs/dev dir. */
function artifactsExist(id: string): boolean {
  return loadWorkItem(id) !== null || fs.existsSync(devArtifactDir(id));
}

/**
 * Publish a complete work item file under `id`, failing if the id is taken.
 *
 * The content is written to a hidden temp file in the same directory and then `link`ed to the
 * final name: `link` fails with EEXIST instead of overwriting, so two concurrent callers can
 * never both succeed, and no empty or partial `<id>.json` is ever visible (a crash leaves at most
 * a hidden temp file). Returns false when the id is taken.
 */
function publishWorkItem(id: string, workItem: WorkItem): boolean {
  const file = workItemJsonPath(id);
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  // `.tasks` must be a real directory: a committed symlink there could redirect the write.
  if (fs.lstatSync(dir).isSymbolicLink()) {
    throw new Error(`bootstrap: ${dir} is a symlink; refusing to write work items through it`);
  }
  const tmp = path.join(dir, `.${id}.json.new-${process.pid}-${Date.now()}`);
  fs.writeFileSync(tmp, `${JSON.stringify(workItem, null, 2)}\n`, { flag: "wx" });
  try {
    fs.linkSync(tmp, file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  } finally {
    fs.rmSync(tmp, { force: true });
  }
}

export function bootstrapWorkItem(input: BootstrapWorkItemInput): Result<BootstrapWorkItemOutput> {
  const title = input.title.trim();
  if (!title) return err("bootstrap requires a title");
  if (DEV_WORK_ITEM_ID_PATTERN.test(title)) {
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
  const entry = entryPhaseFor(pattern, input.variant);

  if (input.adhoc) {
    if (input.id) return err("bootstrap --adhoc generates the id; do not pass one");
    // Entry phases that resume with phase-gather fetch tracker ticket context, which an ad-hoc
    // id does not have.
    if (resolveResumeAgentId(entry, pattern) === "phase-gather") {
      return err(
        `--adhoc cannot start a ${pattern} work item: it begins by fetching tracker ticket context (phase ${entry}), and an ad-hoc id has no ticket. Use a real ticket id: bootstrap <ID> <title>.`,
      );
    }
  } else if (!input.id || !DEV_WORK_ITEM_ID_PATTERN.test(input.id)) {
    return err(`bootstrap: "${input.id ?? ""}" is not a work item id (expected e.g. ACCORD-1234).`);
  }

  try {
    const build = (id: string) =>
      buildBootstrapWorkItem(id, title, pattern, input.variant, {
        expected_finish: title.slice(0, 240),
      });

    if (!input.adhoc) {
      const id = input.id as string;
      const workItem = build(id);
      if (artifactsExist(id) || !publishWorkItem(id, workItem)) {
        return err(`bootstrap: work item ${id} already exists. Use: accord resume ${id}`);
      }
      return ok({
        id,
        path: workItemJsonPath(id),
        work_item: workItem,
        next: nextCommand(id, workItem),
      });
    }

    // Ad-hoc: take the first free slot. Slots lost to a concurrent allocator are skipped.
    const lost = new Set<string>();
    for (let attempt = 0; attempt < 99; attempt++) {
      const id = nextSyntheticWorkItemId(
        (candidate) => lost.has(candidate) || artifactsExist(candidate),
        input.now,
      );
      const workItem = build(id);
      if (publishWorkItem(id, workItem)) {
        return ok({
          id,
          path: workItemJsonPath(id),
          work_item: workItem,
          next: nextCommand(id, workItem),
        });
      }
      lost.add(id);
    }
    return err("bootstrap: could not allocate a free ad-hoc id");
  } catch (error) {
    return err(error instanceof Error ? error.message : String(error));
  }
}

function nextCommand(id: string, workItem: WorkItem): string {
  return workItem.phase === "aligning" ? `accord align ${id}` : `accord resume ${id}`;
}
