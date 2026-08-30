/**
 * Write spec.md alongside a validated spec.json (derived artifact).
 */

import { writeFileSync } from "node:fs";
import * as path from "node:path";
import { err, ok, type Result } from "../types/result.js";
import { readJson } from "../work-items/io.js";
import { renderSpecMarkdown } from "./render-spec-markdown.js";

export function specMarkdownPathForJson(specJsonPath: string): string {
  return path.join(path.dirname(specJsonPath), "spec.md");
}

/** Regenerate spec.md from spec.json when the JSON path looks like a dev spec artifact. */
export function syncSpecMarkdownFromJson(specJsonPath: string): Result<{ specMdPath: string }> {
  const normalized = specJsonPath.replace(/\\/g, "/");
  if (!/\/docs\/dev\/[^/]+\/spec\.json$/i.test(normalized)) {
    return { ok: true, value: { specMdPath: specMarkdownPathForJson(specJsonPath) } };
  }

  const spec = readJson<Record<string, unknown>>(specJsonPath);
  if (!spec) {
    return err(`Cannot read spec JSON: ${specJsonPath}`);
  }

  const specMdPath = specMarkdownPathForJson(specJsonPath);
  writeFileSync(specMdPath, renderSpecMarkdown(spec), "utf8");
  return ok({ specMdPath });
}
