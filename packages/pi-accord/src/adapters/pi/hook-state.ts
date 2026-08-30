import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DevHarnessConfig } from "../../core/config/index.js";
import { discoverWorkItems, readHarnessRunMeta } from "../../core/telemetry/usage.js";
import type { AccordToolBundle } from "../../core/tools/active-set.js";

export interface HookState {
  devConfig: DevHarnessConfig | null;
  sessionCost: number;
  activeWorkItem: string | null;
  /** Dedup pi.appendEntry for persisted dev-harness-run markers (session review / @sessions). */
  _harnessSessionMarkerFp: string | null;
  /** In-memory running cost totals per work item. Seeded from file on session_start,
   *  incremented on each usage event. Avoids re-parsing full JSONL on every append. */
  costCache: Map<string, number>;
  /** Phase 2 — bundles activated for dynamic `dev_*` tool surface. */
  activatedToolBundles: Set<AccordToolBundle>;
}

/**
 * Persist harness run identity into the Pi session transcript (`appendEntry`)
 * so saved sessions list / replay can be filtered or grouped with `.tasks/` usage.
 * No-ops until run_id/tag exist (env, `/dev tag`, or auto `.harness-run.json`).
 */
export function syncHarnessRunSessionEntry(pi: ExtensionAPI, state: HookState): void {
  const envTag = process.env.DEV_HARNESS_RUN_TAG?.trim();
  const envRunId = process.env.DEV_HARNESS_RUN_ID?.trim();
  const meta = readHarnessRunMeta();
  const harness_run_id = envRunId || meta?.run_id;
  const harness_session_tag = envTag || meta?.tag;
  if (!harness_run_id && !harness_session_tag) return;

  const items = discoverWorkItems();
  const work_item_id =
    state.activeWorkItem ?? (items.length >= 1 ? items[0].id : null) ?? undefined;
  const work_item_ids = meta?.work_item_ids ?? (work_item_id ? [work_item_id] : []);

  const fp = JSON.stringify([
    harness_run_id ?? null,
    harness_session_tag ?? null,
    work_item_ids,
    meta?.auto ? "a" : meta ? "m" : "e",
  ]);
  if (fp === state._harnessSessionMarkerFp) return;
  state._harnessSessionMarkerFp = fp;

  pi.appendEntry("dev-harness-run", {
    schema_version: "1.1",
    harness_run_id: harness_run_id ?? undefined,
    harness_session_tag: harness_session_tag ?? undefined,
    work_item_id,
    work_item_ids: work_item_ids.length > 0 ? work_item_ids : undefined,
    auto_provisioned: meta?.auto ?? false,
    cwd: process.cwd(),
    updated_at: new Date().toISOString(),
  });
}
