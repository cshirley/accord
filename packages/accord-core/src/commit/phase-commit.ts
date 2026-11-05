import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveStackConfig } from "../config/stack-flags.js";
import type { DevHarnessConfig } from "../config/types.js";
import {
  commitWithMessage,
  extractStatusPaths,
  git,
  gitRoot,
  isSecretFile,
} from "../git/helpers.js";
import { createLogger } from "../logging.js";
import { pathMatchesCandidate } from "../orchestration/commit-on-task-done.js";
import { redactText } from "../state/redact.js";
import { stateSnapshotDirRel, writeStateSnapshot } from "../state/snapshot.js";
import { parseRef, parseRound } from "../tasks/model.js";
import { emitStackEvent } from "../telemetry/stack-events.js";
import { readUsageLines } from "../telemetry/usage.js";
import { devArtifactDirRel } from "../work-items/artifact-discovery.js";
import { readJson } from "../work-items/io.js";
import { type AccordTrailer, buildCommitMessage, parseAccordTrailer } from "./commit-grammar.js";
import { guardStagedPaths, guardTrailer } from "./commit-guard.js";

export interface PhaseCommitResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  hash?: string;
  files?: string[];
  respawn?: string;
}

const PHASE_AGENTS = new Set([
  "phase-test",
  "review-test",
  "phase-code",
  "review-security",
  "review-code",
  "phase-verify-task",
]);
const REVIEW_AGENTS = new Set(["review-test", "review-security", "review-code"]);
const SEVERITY_KEY: Record<string, "crit" | "warn" | "sugg"> = {
  critical: "crit",
  warning: "warn",
  suggestion: "sugg",
};
const HISTORY_LIMIT = 500;

interface PacketFinding {
  severity?: string;
  issue?: string;
  file?: string;
  evidence?: string;
  recommendation?: string;
}

function packetFindings(packet: Record<string, unknown>): PacketFinding[] {
  return Array.isArray(packet.findings) ? (packet.findings as PacketFinding[]) : [];
}

function packetFiles(packet: Record<string, unknown>): string[] {
  const files: string[] = [];
  for (const key of ["test_files", "stub_files", "files_changed"]) {
    const value = packet[key];
    if (Array.isArray(value))
      files.push(...value.filter((f): f is string => typeof f === "string"));
  }
  if (Array.isArray(packet.changes)) {
    for (const change of packet.changes as Array<{ file?: unknown }>) {
      if (typeof change?.file === "string") files.push(change.file);
    }
  }
  return files;
}

function planFiles(root: string, workItemId: string, taskId: number): string[] {
  const plan = readJson<{ tasks?: Array<{ id: number; files?: unknown[] }> }>(
    join(root, devArtifactDirRel(workItemId), "plan.json"),
  );
  const entry = plan?.tasks?.find((task) => task.id === taskId);
  if (!entry || !Array.isArray(entry.files)) return [];
  const out: string[] = [];
  for (const file of entry.files) {
    if (typeof file === "string") out.push(file);
    else if (typeof (file as { path?: unknown })?.path === "string") {
      out.push((file as { path: string }).path);
    }
  }
  return out;
}

function renderReviewMarkdown(
  ref: string,
  agent: string,
  packet: Record<string, unknown>,
  findings: PacketFinding[],
): string {
  const lines = [
    `# ${ref}`,
    "",
    `- agent: ${agent}`,
    `- verdict: ${typeof packet.verdict === "string" ? packet.verdict : findings.length ? "issues" : "clean"}`,
    `- findings: ${String(findings.length)}`,
    "",
  ];
  findings.forEach((finding, index) => {
    lines.push(`## ${String(index + 1)}. ${finding.severity ?? "unknown"}: ${finding.issue ?? ""}`);
    if (finding.file) lines.push(`- file: ${finding.file}`);
    if (finding.evidence) lines.push(`- evidence: ${finding.evidence}`);
    if (finding.recommendation) lines.push(`- recommendation: ${finding.recommendation}`);
    lines.push("");
  });
  return `${lines.join("\n")}\n`;
}

async function priorTrailers(
  root: string,
): Promise<Array<{ trailer: AccordTrailer | null; sha: string }>> {
  const raw = await git(["log", "-n", String(HISTORY_LIMIT), "--format=%H%x1f%B%x1e"], root).catch(
    () => "",
  );
  const out: Array<{ trailer: AccordTrailer | null; sha: string }> = [];
  for (const record of raw.split("\x1e")) {
    const [sha, body] = record.replace(/^\n/, "").split("\x1f");
    if (!sha) continue;
    let trailer: AccordTrailer | null = null;
    try {
      trailer = parseAccordTrailer(body ?? "");
    } catch {
      trailer = null;
    }
    out.push({ trailer, sha: sha.trim() });
  }
  return out;
}

async function reportAgentCommits(
  root: string,
  workItemId: string,
  ref: string,
  history: Array<{ trailer: AccordTrailer | null; sha: string }>,
): Promise<void> {
  const anchor = history.findIndex((entry) => entry.trailer !== null);
  if (anchor <= 0) return;
  for (const entry of history.slice(0, anchor)) {
    const files = await git(["show", "--name-only", "--pretty=format:", entry.sha], root).catch(
      () => "",
    );
    const first = files.split("\n").find((line) => line.trim() !== "");
    emitStackEvent("stack.guard.rejected", {
      work_item_id: workItemId,
      ref,
      rule: "agent-commit",
      path: first ?? entry.sha,
    });
  }
}

/**
 * Orchestrator-made commit for one completed phase, when `stack.commits` is `"phase"`.
 * Never amends: every call appends (an empty commit when nothing is staged).
 */
export async function tryCommitPhase(
  workItemId: string,
  taskId: number,
  ref: string,
  agent: string,
  packet: Record<string, unknown>,
  devConfig: DevHarnessConfig | null | undefined,
  cwd: string,
): Promise<PhaseCommitResult> {
  if (resolveStackConfig(devConfig).commits !== "phase") {
    return { ok: true, skipped: true, reason: "stack.commits is not phase" };
  }
  if (!PHASE_AGENTS.has(agent)) return { ok: true, skipped: true, reason: "not a phase agent" };
  const parsedRef = parseRef(ref);
  const parsedRound = parsedRef ? parseRound(parsedRef.round) : null;
  if (!parsedRef || !parsedRound) return { ok: false, reason: `invalid ref: ${ref}` };

  try {
    const root = await gitRoot(cwd);
    const history = await priorTrailers(root);
    await reportAgentCommits(root, workItemId, ref, history);

    const devDir = devArtifactDirRel(workItemId);
    const snapshotOn = (() => {
      const { state } = resolveStackConfig(devConfig);
      return state.persist === "tree" && state.redact;
    })();
    if (snapshotOn) writeStateSnapshot(workItemId, taskId, devConfig, root);
    const findings = REVIEW_AGENTS.has(agent) ? packetFindings(packet) : [];
    const candidates: string[] = [];
    let reviewPath: string | undefined;
    if (REVIEW_AGENTS.has(agent)) {
      reviewPath = `${devDir}/reviews/task-${String(taskId)}/${ref.replace("/", "-")}.md`;
      const markdown = redactText(renderReviewMarkdown(ref, agent, packet, findings)).value;
      const absolute = join(root, reviewPath);
      mkdirSync(dirname(absolute), { recursive: true });
      writeFileSync(absolute, markdown, "utf8");
      candidates.push(reviewPath, `${devDir}/state/`);
    } else if (agent === "phase-verify-task") {
      candidates.push(`${devDir}/state/`);
    } else {
      candidates.push(...packetFiles(packet), ...planFiles(root, workItemId, taskId));
    }
    if (snapshotOn) candidates.push(`${stateSnapshotDirRel(workItemId, taskId)}/`);

    const statusRaw = await git(["status", "--porcelain", "--untracked-files=all"], root);
    const dirty = extractStatusPaths(statusRaw).filter(
      (file) =>
        file &&
        !isSecretFile(file) &&
        !file.split("/").includes(".tasks") &&
        candidates.some((candidate) => pathMatchesCandidate(file, candidate)),
    );
    const guarded = guardStagedPaths(
      agent,
      workItemId,
      [...new Set(dirty)],
      devConfig?.test?.file_pattern ?? "",
      ref,
    );

    const stagedRaw = await git(["diff", "--cached", "--name-only"], root);
    const staged = stagedRaw.split("\n").filter((line) => line.trim() !== "");
    const keptSet = new Set(guarded.kept);
    const strayStaged = staged.filter((file) => !keptSet.has(file));
    if (strayStaged.length > 0) {
      const alreadyLogged = new Set(guarded.rejected);
      guardStagedPaths(
        agent,
        workItemId,
        strayStaged.filter((file) => !alreadyLogged.has(file)),
        devConfig?.test?.file_pattern ?? "",
        ref,
      );
      for (const file of strayStaged) {
        await git(["restore", "--staged", "--", file], root);
      }
    }

    const seqs = history
      .filter((entry) => entry.trailer?.id === workItemId && entry.trailer.task === taskId)
      .map((entry) => Number(entry.trailer?.seq) || 0);
    const trailer: AccordTrailer = {
      v: 1,
      id: workItemId,
      task: taskId,
      seq: Math.max(0, ...seqs) + 1,
      ref,
      agent,
      loop: parsedRound.loop,
      round: parsedRound.n,
      outcome: String(packet.verdict ?? packet.status ?? "done").replace(/\s+/g, "_"),
    };
    for (const finding of findings) {
      const key = SEVERITY_KEY[finding.severity ?? ""];
      if (key) trailer[key] = ((trailer[key] as number | undefined) ?? 0) + 1;
    }

    const prior = history
      .map((entry) => entry.trailer)
      .filter(
        (entry): entry is AccordTrailer =>
          entry !== null &&
          entry.id === workItemId &&
          entry.task === taskId &&
          entry.agent === agent,
      );
    const lines = readUsageLines(workItemId).filter(
      (line) => line.subagent_type === agent && line.task_id === taskId,
    );
    const sum = (pick: (line: (typeof lines)[number]) => number): number =>
      lines.reduce((total, line) => total + pick(line), 0);
    const priorSum = (key: string): number =>
      prior.reduce((total, entry) => total + (Number(entry[key]) || 0), 0);
    const tokIn = sum((line) => line.usage.input) - priorSum("tok_in");
    const tokOut = sum((line) => line.usage.output) - priorSum("tok_out");
    const usdU = Math.round(sum((line) => line.usage.cost) * 1_000_000) - priorSum("usd_u");
    if (tokIn > 0) trailer.tok_in = tokIn;
    if (tokOut > 0) trailer.tok_out = tokOut;
    if (usdU > 0) trailer.usd_u = usdU;

    const count = findings.filter((finding) => SEVERITY_KEY[finding.severity ?? ""]).length;
    const trailerGuard = guardTrailer(
      workItemId,
      trailer,
      REVIEW_AGENTS.has(agent) ? { findingsCount: count } : undefined,
    );
    if (!trailerGuard.ok) return { ok: false, reason: trailerGuard.errors.join("; ") };

    const summary = REVIEW_AGENTS.has(agent)
      ? `${agent} ${String(findings.length)} finding(s)`
      : `${agent} complete`;
    const message = buildCommitMessage({ summary, trailer });
    const { hash } = await commitWithMessage(root, guarded.kept, message, undefined, {
      allowEmpty: true,
    });
    try {
      emitStackEvent("stack.commit.created", {
        work_item_id: workItemId,
        ref,
        outcome: trailer.outcome,
        sha: hash,
      });
    } catch (emitError) {
      createLogger("commit").warn(
        `stack.commit.created emit failed: ${emitError instanceof Error ? emitError.message : String(emitError)}`,
      );
    }
    return {
      ok: true,
      hash,
      files: guarded.kept,
      ...(guarded.respawn ? { respawn: guarded.respawn } : {}),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    createLogger("commit").warn(`phase commit ${ref} failed: ${reason}`);
    return { ok: false, reason };
  }
}
