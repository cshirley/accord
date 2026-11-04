import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parseFeatureDoc } from "./feature-doc.js";
import { analyseImpact, type ImpactResult } from "./impact.js";

export type DisclosureLevel = "index" | "feature" | "change" | "evidence";

export interface FindFeaturesOptions {
  repoRoot: string;
  /** Default: docs/features. */
  root?: string;
  query?: string;
  path?: string;
  /** Deepest disclosure level to read. Default: evidence. */
  depth?: DisclosureLevel;
}

export interface FeatureMatch {
  id: string;
  title: string;
  status: string;
  path: string;
  anchors: { code: string[]; interfaces: string[] };
  acs?: unknown[];
  changes?: unknown[];
  evidence?: Array<{ path: string; content: string }>;
}

export interface FindFeaturesResult {
  matches: FeatureMatch[];
  reads: Array<{ level: DisclosureLevel; path: string }>;
}

export interface ImpactForOptions {
  repoRoot: string;
  root?: string;
  /** Work item id; the plan is read from docs/dev/<id>/plan.json. */
  id: string;
}

const DEFAULT_ROOT = "docs/features";
const LEVELS: DisclosureLevel[] = ["index", "feature", "change", "evidence"];

const normalisePath = (path: string): string => path.replace(/\\/g, "/").replace(/^(\.\/)+/, "");

interface IndexEntry {
  id: string;
  title?: string;
  description?: string;
  tags?: string[];
  status?: string;
  path?: string;
  anchors?: { code?: string[]; interfaces?: string[] };
}

function readIndex(repoRoot: string, root: string): { features: IndexEntry[] } {
  const file = join(repoRoot, root, "index.json");
  if (!existsSync(file)) throw new Error(`Feature index not found: ${root}/index.json`);
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { features?: IndexEntry[] };
  return { features: Array.isArray(parsed.features) ? parsed.features : [] };
}

export function findFeatures(options: FindFeaturesOptions): FindFeaturesResult {
  const { repoRoot } = options;
  const root = options.root ?? DEFAULT_ROOT;
  const depthIndex = LEVELS.indexOf(options.depth ?? "evidence");
  const query = options.query?.trim().toLowerCase();
  const path = options.path ? normalisePath(options.path) : undefined;
  if (!query && !path) throw new Error("findFeatures requires a non-empty query or path");

  const index = readIndex(repoRoot, root);
  const reads: FindFeaturesResult["reads"] = [{ level: "index", path: `${root}/index.json` }];
  const entries = index.features.filter((entry) => {
    if (path) return (entry.anchors?.code ?? []).includes(path);
    const haystack = [entry.id, entry.title ?? "", entry.description ?? "", ...(entry.tags ?? [])];
    return haystack.some((text) => text.toLowerCase().includes(query as string));
  });

  const matches: FeatureMatch[] = entries.map((entry) => {
    const match: FeatureMatch = {
      id: entry.id,
      title: entry.title ?? entry.id,
      status: entry.status ?? "",
      path: entry.path ?? `${entry.id}.md`,
      anchors: {
        code: entry.anchors?.code ?? [],
        interfaces: entry.anchors?.interfaces ?? [],
      },
    };
    if (depthIndex < 1) return match;
    const docRel = `${root}/${match.path}`;
    const docFile = join(repoRoot, docRel);
    if (!existsSync(docFile)) return match;
    const doc = parseFeatureDoc(readFileSync(docFile, "utf8"), match.path);
    reads.push({ level: "feature", path: docRel });
    if (!doc) return match;
    match.acs = doc.acs;
    if (depthIndex < 2) return match;
    reads.push({ level: "change", path: docRel });
    match.changes = doc.changes;
    if (depthIndex < 3) return match;
    const evidence: NonNullable<FeatureMatch["evidence"]> = [];
    for (const change of doc.changes) {
      const rel = (change as { evidence?: unknown } | null)?.evidence;
      if (typeof rel !== "string" || rel === "") continue;
      const full = resolve(repoRoot, rel);
      const outside = relative(resolve(repoRoot), full);
      if (outside === ".." || outside.startsWith(`..${sep}`) || !existsSync(full)) continue;
      reads.push({ level: "evidence", path: rel });
      evidence.push({ path: rel, content: readFileSync(full, "utf8") });
    }
    match.evidence = evidence;
    return match;
  });

  return { matches, reads };
}

export function impactFor(options: ImpactForOptions): ImpactResult {
  const root = options.root ?? DEFAULT_ROOT;
  const planFile = join(options.repoRoot, "docs", "dev", options.id, "plan.json");
  if (!existsSync(planFile)) throw new Error(`plan.json not found for work item ${options.id}`);
  const plan = JSON.parse(readFileSync(planFile, "utf8")) as Parameters<typeof analyseImpact>[0];
  const index = readIndex(options.repoRoot, root) as Parameters<typeof analyseImpact>[1];
  return analyseImpact(plan, index);
}

/** Creates the knowledge root with an empty index; never scans the repo. */
export function initFeatures(options: { repoRoot: string; root?: string }): { index: string } {
  const index = join(options.repoRoot, options.root ?? DEFAULT_ROOT, "index.json");
  mkdirSync(dirname(index), { recursive: true });
  if (!existsSync(index)) writeFileSync(index, `${JSON.stringify({ features: [] }, null, 2)}\n`);
  return { index };
}
