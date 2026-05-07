/**
 * Checkpoint management for multi-turn phases (spec, plan, gaps).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Checkpoint } from "./types.js";
import { TASKS_DIR, readJson, writeJson } from "./io.js";

export function devCheckpointRead(id: string): Checkpoint | null {
  return readJson<Checkpoint>(path.join(TASKS_DIR, `${id}-checkpoint.json`));
}

export function devCheckpointWrite(id: string, data: Checkpoint): { path: string } {
  const cpPath = path.join(TASKS_DIR, `${id}-checkpoint.json`);
  writeJson(cpPath, { ...data, schema_version: "1.0" });
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
