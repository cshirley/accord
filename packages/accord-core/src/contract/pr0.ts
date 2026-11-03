import { createHash } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { syncSpecMarkdownFromJson } from "../artifacts/spec-markdown.js";
import { type AccordTrailer, buildCommitMessage } from "../commit/commit-grammar.js";
import { resolveKnowledgeConfig, resolveStackConfig } from "../config/stack-flags.js";
import type { DevHarnessConfig } from "../config/types.js";
import { commitWithMessage, git, gitRoot } from "../git/helpers.js";
import { analyseImpact, type ImpactIndex, type ImpactPlan } from "../knowledge/impact.js";
import { redactText } from "../state/redact.js";
import { emitStackEvent } from "../telemetry/stack-events.js";
import { mutateJson, now, readJson, writeJson } from "../work-items/io.js";
import { resolveWorkItemFilePath } from "../work-items/tasks-dir.js";
import { isAmendOpen, lockedPaths, writeContractLock } from "./lock.js";

export interface ContractPr0Result {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  hash?: string;
  tag?: string;
}

export type PreLockHook = (workItemId: string, cwd: string) => void | Promise<void>;

const preLockHooks = new Set<PreLockHook>();

export function registerPreLockHook(hook: PreLockHook): () => void {
  const entry: PreLockHook = (workItemId, cwd) => hook(workItemId, cwd);
  preLockHooks.add(entry);
  return () => {
    preLockHooks.delete(entry);
  };
}

let activeConfig: DevHarnessConfig | null | undefined;

registerPreLockHook((workItemId, cwd) => {
  const knowledge = resolveKnowledgeConfig(activeConfig);
  if (!knowledge.enabled) return;
  const base = `docs/dev/${workItemId}`;
  const index = readJson<ImpactIndex>(join(cwd, knowledge.root, "index.json"));
  const plan = readJson<ImpactPlan>(join(cwd, base, "plan.json"));
  const specPath = join(cwd, base, "spec.json");
  const spec = readJson<Record<string, unknown>>(specPath);
  if (!index || !plan || !spec) return;
  const { rows, decisions } = analyseImpact(plan, index);
  if (rows.length > 0) {
    const features = rows.map((row) => ({
      slug: row.slug,
      relation: row.relation,
      delta: row.delta ?? row.relation,
    }));
    writeJson(specPath, { ...spec, features });
    syncSpecMarkdownFromJson(specPath);
  }
  const workItemPath = resolveWorkItemFilePath(workItemId, cwd);
  if (decisions.length === 0 || !workItemPath) return;
  mutateJson<Record<string, unknown>>(workItemPath, (current) => {
    if (!current) return undefined;
    const existing = Array.isArray(current.decisions)
      ? (current.decisions as Array<Record<string, unknown>>)
      : [];
    const ids = new Set(existing.map((decision) => decision.id));
    const added = decisions
      .map((decision) => ({
        id: `impact-${decision.kind}-${createHash("sha1").update(decision.question).digest("hex").slice(0, 8)}`,
        question: decision.question,
        context: decision.context,
        source: "plan",
        phase: typeof current.phase === "string" && current.phase ? current.phase : "planning",
        status: "pending",
        asked_at: now(),
      }))
      .filter((decision) => !ids.has(decision.id));
    return { ...current, decisions: [...existing, ...added] };
  });
});

const skipped = (reason: string): ContractPr0Result => ({ ok: true, skipped: true, reason });

async function unstage(root: string, paths: string[]): Promise<void> {
  await git(["reset", "-q", "--", ...paths], root).catch(() => {});
}

export async function buildContractPr0(
  workItemId: string,
  devConfig: DevHarnessConfig | null | undefined,
  cwd: string,
): Promise<ContractPr0Result> {
  const stack = resolveStackConfig(devConfig);
  if (!stack.enabled) return skipped("stack disabled");
  if (devConfig?.stack?.contract?.lock === false) return skipped("contract lock disabled");

  const root = await gitRoot(cwd);
  const workItemPath = resolveWorkItemFilePath(workItemId, root);
  const workItem = workItemPath ? readJson<Record<string, unknown>>(workItemPath) : null;
  if (!workItem) return skipped("work item file not found");
  if (workItem.pattern !== "implement" && workItem.pattern !== "greenfield") {
    return skipped(`pattern ${String(workItem.pattern)} has no contract PR`);
  }
  const base = `docs/dev/${workItemId}`;
  const lockRel = `${base}/contract.lock.json`;
  if (existsSync(join(root, lockRel))) return skipped("contract.lock.json present");
  if (isAmendOpen(workItemId, root)) return skipped("contract amend open");

  activeConfig = devConfig;
  try {
    for (const hook of [...preLockHooks]) await hook(workItemId, root);
  } finally {
    activeConfig = undefined;
  }
  const hookedWorkItem = readJson<Record<string, unknown>>(workItemPath as string) ?? workItem;

  const stateRel = `${base}/state/work-item.json`;
  const statePath = join(root, stateRel);
  mkdirSync(dirname(statePath), { recursive: true });
  writeFileSync(
    statePath,
    redactText(`${JSON.stringify(hookedWorkItem, null, 2)}\n`).value,
    "utf8",
  );
  await writeContractLock(workItemId, root);

  const specMdRel = `${base}/spec.md`;
  const owned = [
    ...lockedPaths(workItemId),
    ...(existsSync(join(root, specMdRel)) ? [specMdRel] : []),
    stateRel,
    lockRel,
  ];
  let hash: string;
  try {
    const staged = (await git(["diff", "--cached", "--name-only"], root))
      .split("\n")
      .filter((file) => file && !owned.includes(file));
    for (const file of staged) await git(["restore", "--staged", "--", file], root);
    const trailer: AccordTrailer = {
      v: 1,
      id: workItemId,
      task: 0,
      seq: 1,
      ref: "contract-pr0",
      agent: "harness",
      loop: "contract",
      round: 0,
      outcome: "locked",
    };
    const message = buildCommitMessage({ summary: "lock contract (PR0)", trailer });
    hash = (await commitWithMessage(root, owned, message)).hash;
  } catch (error) {
    await unstage(root, owned);
    rmSync(join(root, lockRel), { force: true });
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, reason: `PR0 contract commit failed: ${detail}` };
  }
  emitStackEvent("stack.commit.created", {
    work_item_id: workItemId,
    ref: "contract-pr0",
    outcome: "locked",
    sha: hash,
  });

  if (devConfig?.stack?.contract?.tag === false) return { ok: true, hash };
  const tag = `accord/${workItemId}/contract`;
  const existing = (await git(["tag", "-l", tag], root).catch(() => "")).trim();
  if (existing === tag) return { ok: true, hash };
  try {
    await git(["tag", tag, "HEAD"], root);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, hash, reason: `PR0 contract tag ${tag} failed: ${detail}` };
  }
  return { ok: true, hash, tag };
}
