import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parse as parseYaml } from "yaml";

export type FeatureValidationCode =
  | "broken-anchor"
  | "broken-link"
  | "ac-without-test"
  | "unresolved-test"
  | "too-many-acs";

export interface FeatureValidationError {
  feature: string;
  code: FeatureValidationCode;
  message: string;
}

export interface FeatureValidationResult {
  ok: boolean;
  errors: FeatureValidationError[];
}

export interface FeatureValidationOptions {
  /** Repository root that anchors and test references resolve against. */
  repoRoot: string;
  /** Feature docs directory relative to repoRoot. Default: docs/features. */
  root?: string;
  /** Default: 12. */
  maxAcsPerFeature?: number;
}

export interface FeatureAc {
  id: string;
  text: string;
  tests: string[];
}

export interface FeatureDoc {
  id: string;
  type: string;
  title: string;
  description: string;
  tags: string[];
  status: string;
  owners: string[];
  acs: FeatureAc[];
  anchors: { code: string[]; interfaces: string[] };
  depends_on: string[];
  related: string[];
  supersedes: string[];
  changes: unknown[];
  /** Path relative to the features root, posix separators. */
  path: string;
  /** Markdown body after the frontmatter. */
  body: string;
}

const DEFAULT_ROOT = "docs/features";
const DEFAULT_MAX_ACS = 12;

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

function listMarkdown(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listMarkdown(full, base));
    else if (entry.isFile() && entry.name.endsWith(".md") && entry.name !== "index.md")
      found.push(relative(base, full).split(sep).join("/"));
  }
  return found.sort();
}

export function parseFeatureDoc(text: string, path: string): FeatureDoc | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/.exec(text);
  if (!match) return null;
  let raw: unknown;
  try {
    raw = parseYaml(match[1] ?? "");
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const fm = raw as Record<string, unknown>;
  if (typeof fm.id !== "string" || fm.id === "") return null;
  const anchors = (fm.anchors ?? {}) as Record<string, unknown>;
  const acs: FeatureAc[] = [];
  if (Array.isArray(fm.acs)) {
    for (const item of fm.acs) {
      if (!item || typeof item !== "object") continue;
      const ac = item as Record<string, unknown>;
      acs.push({
        id: String(ac.id ?? ""),
        text: typeof ac.text === "string" ? ac.text : "",
        tests: strings(ac.tests),
      });
    }
  }
  return {
    id: fm.id,
    type: typeof fm.type === "string" ? fm.type : "",
    title: typeof fm.title === "string" ? fm.title : fm.id,
    description: typeof fm.description === "string" ? fm.description : "",
    tags: strings(fm.tags),
    status: typeof fm.status === "string" ? fm.status : "",
    owners: strings(fm.owners),
    acs,
    anchors: { code: strings(anchors.code), interfaces: strings(anchors.interfaces) },
    depends_on: strings(fm.depends_on),
    related: strings(fm.related),
    supersedes: strings(fm.supersedes),
    changes: Array.isArray(fm.changes) ? fm.changes : [],
    path,
    body: match[2] ?? "",
  };
}

/** Parses every feature doc under repoRoot/root (index.md excluded), sorted by id. */
export function loadFeatureDocs(repoRoot: string, root: string = DEFAULT_ROOT): FeatureDoc[] {
  const dir = join(repoRoot, root);
  const docs: FeatureDoc[] = [];
  for (const rel of listMarkdown(dir)) {
    const doc = parseFeatureDoc(readFileSync(join(dir, rel), "utf8"), rel);
    if (doc) docs.push(doc);
  }
  return docs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function insideRepo(repoRoot: string, target: string): boolean {
  const rel = relative(repoRoot, target);
  return rel !== ".." && !rel.startsWith(`..${sep}`);
}

function bodyLinks(body: string): string[] {
  const links: string[] = [];
  let fenced = false;
  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    for (const match of line.matchAll(/\[[^\]]*\]\(([^)\s]+)[^)]*\)/g)) links.push(match[1] ?? "");
  }
  return links;
}

export function validateFeatures(options: FeatureValidationOptions): FeatureValidationResult {
  const { repoRoot } = options;
  const root = options.root ?? DEFAULT_ROOT;
  const max = options.maxAcsPerFeature ?? DEFAULT_MAX_ACS;
  const docDir = join(repoRoot, root);
  const docs = loadFeatureDocs(repoRoot, root);
  const ids = new Set(docs.map((doc) => doc.id));
  const errors: FeatureValidationError[] = [];
  const add = (feature: string, code: FeatureValidationCode, message: string): void => {
    errors.push({ feature, code, message });
  };

  for (const doc of docs) {
    for (const anchor of doc.anchors.code) {
      const target = resolve(repoRoot, anchor);
      if (!anchor || !insideRepo(repoRoot, target) || !existsSync(target))
        add(doc.id, "broken-anchor", `code anchor does not resolve: ${anchor}`);
    }

    for (const link of bodyLinks(doc.body)) {
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(link) || link.startsWith("#")) continue;
      const path = decodeURI(link.split("#")[0] ?? "");
      if (!path) continue;
      if (!existsSync(resolve(dirname(join(docDir, doc.path)), path)))
        add(doc.id, "broken-link", `link does not resolve: ${link}`);
    }
    for (const ref of [...doc.depends_on, ...doc.related]) {
      if (!ids.has(ref)) add(doc.id, "broken-link", `unknown feature reference: ${ref}`);
    }

    for (const ac of doc.acs) {
      if (ac.tests.length === 0) {
        add(doc.id, "ac-without-test", `AC has no test: ${ac.id}`);
        continue;
      }
      for (const ref of ac.tests) {
        const hash = ref.indexOf("#");
        const file = hash < 0 ? ref : ref.slice(0, hash);
        const name = hash < 0 ? "" : ref.slice(hash + 1);
        const target = resolve(repoRoot, file);
        let ok = file !== "" && name !== "" && insideRepo(repoRoot, target);
        if (ok) ok = existsSync(target) && statSync(target).isFile();
        if (ok) ok = readFileSync(target, "utf8").includes(name);
        if (!ok) add(doc.id, "unresolved-test", `${ac.id} test reference does not resolve: ${ref}`);
      }
    }

    if (doc.acs.length > max)
      add(
        doc.id,
        "too-many-acs",
        `feature ${doc.id} has ${doc.acs.length} ACs, above max_acs_per_feature ${max}; split it`,
      );
  }

  errors.sort((a, b) =>
    `${a.feature}\0${a.code}\0${a.message}`.localeCompare(`${b.feature}\0${b.code}\0${b.message}`),
  );
  return { ok: errors.length === 0, errors };
}
