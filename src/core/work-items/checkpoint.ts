/**
 * Checkpoint management for multi-turn phases (spec, plan, gaps).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Checkpoint } from "./types.js";
import { TASKS_DIR, readJson, writeJson } from "./io.js";
import { createLogger } from "../logging.js";

const log = createLogger("checkpoint");

const CURRENT_CHECKPOINT_SCHEMA_VERSION = "1.0";

export function devCheckpointRead(id: string): Checkpoint | null {
  return readJson<Checkpoint>(path.join(TASKS_DIR, `${id}-checkpoint.json`));
}

/**
 * Stamp every checkpoint with the current schema_version. We deliberately
 * overwrite any caller-supplied version so the on-disk format always matches
 * what the current binary reads back. If the caller passed a different
 * version we log it at debug level so migrations are visible.
 */
export function devCheckpointWrite(id: string, data: Checkpoint): { path: string } {
  const cpPath = path.join(TASKS_DIR, `${id}-checkpoint.json`);
  if (data.schema_version && data.schema_version !== CURRENT_CHECKPOINT_SCHEMA_VERSION) {
    log.debug(
      `normalising checkpoint schema_version "${data.schema_version}" → "${CURRENT_CHECKPOINT_SCHEMA_VERSION}" for ${id}`,
    );
  }
  writeJson(cpPath, { ...data, schema_version: CURRENT_CHECKPOINT_SCHEMA_VERSION });
  return { path: cpPath };
}

export function devCheckpointDelete(id: string): boolean {
  const cpPath = path.join(TASKS_DIR, `${id}-checkpoint.json`);
  if (fs.existsSync(cpPath)) {
    fs.unlinkSync(cpPath);
    return true;
  }
  return false;
}
