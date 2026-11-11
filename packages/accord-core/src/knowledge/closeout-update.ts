import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { resolveKnowledgeConfig } from "../config/stack-flags.js";
import type { DevHarnessConfig } from "../config/types.js";
import { trustedContractLock } from "../contract/lock.js";
import { loadFeatureDocs } from "./feature-doc.js";

export interface KnowledgeCloseoutOptions {
  /** PR reference (URL or number) recorded in the feature doc changes[] entry. */
  pr?: string;
  signal?: AbortSignal;
}

export interface KnowledgeCloseoutResult {
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  /** Repo-root-relative posix paths written under knowledge.root. */
  paths: string[];
}

type Json = Record<string, unknown>;

interface SpecAc {
  id: string;
  feature?: string;
  text: string;
}

const normalisePath = (path: string): string => path.replace(/\\/g, "/").replace(/^(\.\/)+/, "");
const isTestFile = (path: string): boolean =>
  /\.(test|spec)\.[cm]?[jt]sx?$|(^|\/)tests?\//.test(path);
const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function readJsonFile(file: string): Json | null {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as Json;
  } catch {
    return null;
  }
}

function acText(ac: Json): string {
  for (const key of ["scenario", "criterion", "text", "description", "title"]) {
    if (typeof ac[key] === "string" && ac[key] !== "") return ac[key] as string;
  }
  return String(ac.id ?? "");
}

function loadSpecAcs(cwd: string, workItemId: string): SpecAc[] {
  const spec = readJsonFile(join(cwd, "docs", "dev", workItemId, "spec.json"));
  const list = Array.isArray(spec?.acceptance_criteria) ? spec.acceptance_criteria : [];
  return list
    .filter(
      (ac): ac is Json => !!ac && typeof ac === "object" && typeof (ac as Json).id === "string",
    )
    .map((ac) => ({
      id: ac.id as string,
      ...(typeof ac.feature === "string" && ac.feature ? { feature: ac.feature } : {}),
      text: acText(ac),
    }));
}

interface PlanTask {
  id: number;
  files: string[];
}

function loadPlanTasks(cwd: string, workItemId: string): PlanTask[] {
  const plan = readJsonFile(join(cwd, "docs", "dev", workItemId, "plan.json"));
  const tasks = Array.isArray(plan?.tasks) ? plan.tasks : [];
  return tasks
    .filter((task): task is Json => !!task && typeof task === "object")
    .map((task, index) => ({
      id: typeof task.id === "number" ? task.id : index + 1,
      files: (Array.isArray(task.files) ? task.files : [])
        .map((file: unknown) =>
          typeof file === "string" ? file : ((file as Json | null)?.path as unknown),
        )
        .filter((file: unknown): file is string => typeof file === "string" && file !== "")
        .map(normalisePath),
    }));
}

function listTestFiles(cwd: string, planned: string[]): string[] {
  const found = new Set(planned);
  try {
    const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
      cwd,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    for (const line of out.split("\n")) {
      const file = normalisePath(line.trim());
      if (file && isTestFile(file)) found.add(file);
    }
  } catch {
    // not a git repo: planned test files only
  }
  return [...found];
}

function findTests(cwd: string, testFiles: string[], qualifiedId: string): string[] {
  const idPattern = `(?<![A-Za-z0-9_-])${escapeRegExp(qualifiedId)}(?!\\d)`;
  const found: string[] = [];
  for (const file of testFiles) {
    const full = join(cwd, file);
    if (!existsSync(full)) continue;
    const text = readFileSync(full, "utf8");
    for (const quote of ['"', "'", "`"]) {
      const q = escapeRegExp(quote);
      const re = new RegExp(`${q}((?:(?!${q})[^\\n])*?${idPattern}(?:(?!${q})[^\\n])*)${q}`, "g");
      for (const match of text.matchAll(re)) {
        const ref = `${file}#${match[1]}`;
        if (!found.includes(ref)) found.push(ref);
      }
    }
  }
  return found;
}

function splitDoc(text: string): { fm: Json; body: string } | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(text);
  if (!match) return null;
  try {
    const fm = parseYaml(match[1] ?? "");
    if (!fm || typeof fm !== "object" || Array.isArray(fm)) return null;
    return { fm: fm as Json, body: match[2] ?? "" };
  } catch {
    return null;
  }
}

function nextAcId(used: Set<string>): string {
  let max = 0;
  for (const id of used) {
    const match = /^AC-(\d+)$/.exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }
  let candidate = max + 1;
  while (used.has(`AC-${candidate}`)) candidate += 1;
  return `AC-${candidate}`;
}

export async function runKnowledgeCloseoutUpdate(
  workItemId: string,
  devConfig: DevHarnessConfig | null | undefined,
  cwd: string,
  options?: KnowledgeCloseoutOptions,
): Promise<KnowledgeCloseoutResult> {
  const knowledge = resolveKnowledgeConfig(devConfig);
  if (!knowledge.enabled) {
    return { ok: true, skipped: true, reason: "knowledge.enabled is not true", paths: [] };
  }
  const root = knowledge.root.replace(/\/+$/, "");
  const tasks = loadPlanTasks(cwd, workItemId);
  const changed = new Set(tasks.flatMap((task) => task.files));
  const testFiles = listTestFiles(cwd, [...changed].filter(isTestFile));
  const specAcs = loadSpecAcs(cwd, workItemId);
  const contractSha = (await trustedContractLock(workItemId, cwd))?.commit ?? null;
  const paths: string[] = [];

  for (const doc of loadFeatureDocs(cwd, root)) {
    const anchored = doc.anchors.code.map(normalisePath).filter((file) => changed.has(file));
    if (anchored.length === 0) continue;
    const relPath = `${root}/${doc.path}`;
    const full = join(cwd, relPath);
    const original = readFileSync(full, "utf8");
    const parts = splitDoc(original);
    if (!parts) continue;
    const { fm, body } = parts;
    const acs = (Array.isArray(fm.acs) ? fm.acs : []) as Json[];
    const changes = (Array.isArray(fm.changes) ? fm.changes : []) as Json[];
    const existing = changes.find((entry) => entry?.work_item === workItemId);
    const acMap: Record<string, string> =
      existing?.ac_map && typeof existing.ac_map === "object"
        ? { ...(existing.ac_map as Record<string, string>) }
        : {};
    const used = new Set(acs.map((ac) => String(ac.id)));

    for (const specAc of specAcs.filter((ac) => ac.feature === doc.id)) {
      const qualified = `${workItemId}/${specAc.id}`;
      let featureAcId = acMap[qualified];
      let featureAc = acs.find((ac) => ac.id === featureAcId);
      if (!featureAcId || !featureAc) {
        featureAcId = featureAcId ?? nextAcId(used);
        used.add(featureAcId);
        acMap[qualified] = featureAcId;
        featureAc = { id: featureAcId, text: specAc.text, tests: [] };
        acs.push(featureAc);
      }
      const tests = Array.isArray(featureAc.tests) ? (featureAc.tests as string[]) : [];
      for (const ref of findTests(cwd, testFiles, qualified)) {
        if (!tests.includes(ref)) tests.push(ref);
      }
      featureAc.tests = tests;
    }

    if (existing) {
      existing.ac_map = acMap;
    } else {
      const taskId = tasks.find((task) => task.files.some((file) => anchored.includes(file)))?.id;
      changes.push({
        work_item: workItemId,
        ...(options?.pr ? { pr: options.pr } : {}),
        evidence: `docs/dev/${workItemId}/evidence/task-${taskId ?? 1}.md`,
        contract_sha: contractSha,
        ac_map: acMap,
      });
    }
    fm.acs = acs;
    fm.changes = changes;
    const next = `---\n${stringifyYaml(fm).trimEnd()}\n---\n${body}`;
    if (next === original) continue;
    writeFileSync(full, next);
    paths.push(relPath);
  }
  return { ok: true, paths };
}
