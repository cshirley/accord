import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseAccordTrailer } from "../commit/commit-grammar.js";
import { resolveStackConfig } from "../config/stack-flags.js";
import type { DevHarnessConfig } from "../config/types.js";
import { git } from "../git/helpers.js";
import { redactText } from "../state/redact.js";
import { readJson, writeJson } from "../work-items/io.js";
import { measureActualLines } from "./lines.js";
import { qualifyAcRef } from "./qualify-ac.js";

export interface EvidenceLoop {
  rounds: number;
  findings: { crit: number; warn: number; sugg: number };
  responses: { addressed: number; disputed: number; wont_fix: number };
}

export interface EvidenceJson {
  work_item_id: string;
  task: number;
  acs: string[];
  loops: Record<string, EvidenceLoop>;
  tests: { red: { pass: number; fail: number }; green: { pass: number; fail: number } };
  tokens: { in: number; out: number };
  cost: { usd_u: number };
  size: { est_lines?: number; act_prod_lines: number; act_test_lines: number };
  [key: string]: unknown;
}

export interface EvidenceAsset {
  task: number;
  md: string;
  json: EvidenceJson;
}

export interface EvidenceAssetOptions {
  cwd?: string;
  config?: DevHarnessConfig | null;
}

interface TaskCommit {
  sha: string;
  body: string;
  trailer: Record<string, unknown>;
}

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const FIELD = "\x1f";
const RECORD = "\x1e";
const REVIEW_AGENTS = new Set(["review-test", "review-security", "review-code"]);
const BARE_REF = /(?<![A-Za-z0-9_/])(?:AC|TC)-\d+/g;
const TRUNCATION_MARK = "\n\n[truncated: stack.state.max_bytes]\n";
const PATCH_EXCLUDES = [
  ":(exclude,glob)docs/dev/*/state/**",
  ":(exclude,glob)docs/dev/*/reviews/**",
  ":(exclude,glob)docs/dev/*/evidence/**",
];

function num(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function messageBody(message: string): string {
  const lines = message.split(/\r?\n/).filter((line) => !line.startsWith("Accord: "));
  return lines.slice(1).join("\n").trim();
}

async function readCommits(workItemId: string, cwd: string): Promise<Map<number, TaskCommit[]>> {
  const byTask = new Map<number, TaskCommit[]>();
  let out: string;
  try {
    out = await git(["log", "--reverse", `--format=%x1e%H%x1f%B`], cwd);
  } catch {
    return byTask;
  }
  for (const chunk of out.split(RECORD)) {
    const sep = chunk.indexOf(FIELD);
    if (sep < 0) continue;
    const sha = chunk.slice(0, sep).trim();
    const message = chunk.slice(sep + 1);
    let trailer: Record<string, unknown> | null;
    try {
      trailer = parseAccordTrailer(message) as Record<string, unknown> | null;
    } catch {
      continue;
    }
    if (!trailer || trailer.id !== workItemId || typeof trailer.task !== "number") continue;
    const list = byTask.get(trailer.task) ?? [];
    list.push({ sha, body: messageBody(message), trailer });
    byTask.set(trailer.task, list);
  }
  return byTask;
}

async function gitOrEmpty(args: string[], cwd: string): Promise<string> {
  try {
    return await git(args, cwd);
  } catch {
    return "";
  }
}

function emptyLoop(): EvidenceLoop {
  return {
    rounds: 0,
    findings: { crit: 0, warn: 0, sugg: 0 },
    responses: { addressed: 0, disputed: 0, wont_fix: 0 },
  };
}

function qualifyText(workItemId: string, text: string): string {
  return text.replace(BARE_REF, (ref) => `${workItemId}/${ref}`);
}

function fence(text: string): string {
  const longest = Math.max(2, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const ticks = "`".repeat(longest + 1);
  return `${ticks}\n${text.trimEnd()}\n${ticks}`;
}

function capText(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text) <= maxBytes) return text;
  const budget = Math.max(0, maxBytes - Buffer.byteLength(TRUNCATION_MARK));
  const cut = new TextDecoder().decode(Buffer.from(text).subarray(0, budget));
  return `${cut.replace(/\uFFFD+$/u, "")}${TRUNCATION_MARK}`;
}

async function buildOne(
  workItemId: string,
  taskId: number,
  commits: TaskCommit[],
  cwd: string,
  config: DevHarnessConfig | null | undefined,
): Promise<EvidenceAsset> {
  const includeDiffs = config?.stack?.evidence?.include_diffs ?? true;
  const stack = resolveStackConfig(config);
  const loops: Record<string, EvidenceLoop> = {};
  const acs = new Set<string>();
  const tests = { red: { pass: 0, fail: 0 }, green: { pass: 0, fail: 0 } };
  const tokens = { in: 0, out: 0 };
  let usd = 0;
  const excerpts: Array<{ ref: string; outcome: string; body: string }> = [];

  for (const { trailer, body } of commits) {
    const loopName = String(trailer.loop);
    const loop = loops[loopName] ?? emptyLoop();
    loops[loopName] = loop;
    loop.rounds = Math.max(loop.rounds, num(trailer.round));
    loop.findings.crit += num(trailer.crit);
    loop.findings.warn += num(trailer.warn);
    loop.findings.sugg += num(trailer.sugg);
    loop.responses.addressed += num(trailer.addressed);
    loop.responses.disputed += num(trailer.disputed);
    loop.responses.wont_fix += num(trailer.wont_fix);
    tokens.in += num(trailer.tok_in);
    tokens.out += num(trailer.tok_out);
    usd += num(trailer.usd_u);
    if (Array.isArray(trailer.ac)) {
      for (const ac of trailer.ac) acs.add(qualifyAcRef(workItemId, String(ac)));
    }
    if (trailer.outcome === "red" || trailer.outcome === "green") {
      tests[trailer.outcome] = { pass: num(trailer.t_pass), fail: num(trailer.t_fail) };
      if (body !== "") {
        excerpts.push({ ref: String(trailer.ref), outcome: trailer.outcome, body });
      }
    }
  }

  const first = commits[0];
  const last = commits[commits.length - 1];
  const size: EvidenceJson["size"] = { act_prod_lines: 0, act_test_lines: 0 };
  const plan = readJson<{ tasks?: Array<{ id?: number; est_lines?: number }> }>(
    join(cwd, "docs", "dev", workItemId, "plan.json"),
  );
  const planned = plan?.tasks?.find((task) => task.id === taskId)?.est_lines;
  const reviewFiles: Array<{ name: string; text: string }> = [];
  const patches: Array<{ ref: string; patch: string }> = [];

  if (first && last) {
    const parent = (await gitOrEmpty(["rev-parse", "--verify", "-q", `${first.sha}^`], cwd)).trim();
    const measured = await measureActualLines(cwd, parent || EMPTY_TREE, last.sha, {
      testPattern: config?.test?.file_pattern,
    });
    size.act_prod_lines = measured.act_prod_lines;
    size.act_test_lines = measured.act_test_lines;

    const dir = `docs/dev/${workItemId}/reviews/task-${taskId}/`;
    const names = (await gitOrEmpty(["ls-tree", "-r", "--name-only", last.sha, "--", dir], cwd))
      .split("\n")
      .filter((name) => name !== "")
      .sort();
    for (const name of names) {
      reviewFiles.push({ name, text: await gitOrEmpty(["show", `${last.sha}:${name}`], cwd) });
    }

    if (includeDiffs) {
      for (let index = 0; index < commits.length; index += 1) {
        const review = commits[index] as TaskCommit;
        if (!REVIEW_AGENTS.has(String(review.trailer.agent))) continue;
        const next = commits
          .slice(index + 1)
          .find((candidate) => !REVIEW_AGENTS.has(String(candidate.trailer.agent)));
        if (!next) continue;
        const patch = await gitOrEmpty(
          [
            "diff",
            "--no-color",
            "--no-ext-diff",
            review.sha,
            next.sha,
            "--",
            ".",
            ...PATCH_EXCLUDES,
          ],
          cwd,
        );
        if (patch.trim() !== "") patches.push({ ref: String(review.trailer.ref), patch });
      }
    }
  }

  const json: EvidenceJson = {
    work_item_id: workItemId,
    task: taskId,
    acs: [...acs].sort(),
    loops: Object.fromEntries(Object.entries(loops).sort(([a], [b]) => (a < b ? -1 : 1))),
    tests,
    tokens,
    cost: { usd_u: usd },
    size: planned === undefined ? size : { est_lines: planned, ...size },
  };

  const lines: string[] = [`# Evidence: ${workItemId} task-${taskId}`, ""];
  lines.push("## Acceptance criteria", "");
  for (const ac of json.acs) lines.push(`- ${ac}`);
  lines.push("", "## Loops", "");
  lines.push("| loop | rounds | crit | warn | sugg | addressed | disputed | wont_fix |");
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const [name, loop] of Object.entries(json.loops)) {
    lines.push(
      `| ${name} | ${loop.rounds} | ${loop.findings.crit} | ${loop.findings.warn} | ${loop.findings.sugg} | ${loop.responses.addressed} | ${loop.responses.disputed} | ${loop.responses.wont_fix} |`,
    );
  }
  lines.push("", "## Tests", "");
  lines.push(`- red: ${tests.red.pass} pass, ${tests.red.fail} fail`);
  lines.push(`- green: ${tests.green.pass} pass, ${tests.green.fail} fail`);
  lines.push("", "## Cost", "");
  lines.push(`- tokens: ${tokens.in} in, ${tokens.out} out`);
  lines.push(`- cost: ${usd} usd_u`);
  lines.push("", "## Size (planned vs actual)", "");
  lines.push(`- planned: ${planned === undefined ? "n/a" : planned} lines`);
  lines.push(`- actual production: ${size.act_prod_lines} lines`);
  lines.push(`- actual test: ${size.act_test_lines} lines`);
  if (reviewFiles.length > 0) {
    lines.push("", "## Findings");
    for (const file of reviewFiles) lines.push("", `### ${file.name}`, "", file.text.trim());
  }
  if (includeDiffs) {
    if (excerpts.length > 0) {
      lines.push("", "## Red and green output");
      for (const excerpt of excerpts) {
        lines.push("", `### ${excerpt.ref} (${excerpt.outcome})`, "", fence(excerpt.body));
      }
    }
    if (patches.length > 0) {
      lines.push("", "## Review-to-fix patches");
      for (const entry of patches) {
        lines.push("", `### after ${entry.ref}`, "", fence(entry.patch));
      }
    }
  }

  let md = `${lines.join("\n")}\n`;
  if (stack.state.redact) md = redactText(md).value;
  md = capText(qualifyText(workItemId, md), stack.state.max_bytes);
  return { task: taskId, md, json };
}

/** Pure function of git commits, Accord trailers and committed review files. No timestamps. */
export async function buildEvidenceAsset(
  workItemId: string,
  taskIds: number[],
  options: EvidenceAssetOptions = {},
): Promise<EvidenceAsset[]> {
  const cwd = options.cwd ?? process.cwd();
  const byTask = await readCommits(workItemId, cwd);
  const assets: EvidenceAsset[] = [];
  for (const taskId of taskIds) {
    assets.push(await buildOne(workItemId, taskId, byTask.get(taskId) ?? [], cwd, options.config));
  }
  return assets;
}

/** Returns repo-relative paths written. */
export async function writeEvidenceAssets(
  workItemId: string,
  taskIds: number[],
  options: EvidenceAssetOptions = {},
): Promise<string[]> {
  const cwd = options.cwd ?? process.cwd();
  const dirRel = `docs/dev/${workItemId}/evidence`;
  mkdirSync(join(cwd, dirRel), { recursive: true });
  const written: string[] = [];
  for (const asset of await buildEvidenceAsset(workItemId, taskIds, options)) {
    const mdRel = `${dirRel}/task-${asset.task}.md`;
    const jsonRel = `${dirRel}/task-${asset.task}.json`;
    writeFileSync(join(cwd, mdRel), asset.md);
    writeJson(join(cwd, jsonRel), asset.json);
    written.push(mdRel, jsonRel);
  }
  return written;
}
