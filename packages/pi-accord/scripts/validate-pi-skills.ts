import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type PiManifest = {
  schema_version: string;
  host: string;
  assets: {
    skills: string[];
  };
  requires?: {
    pi_extensions?: string[];
    tools?: string[];
  };
};

type PackageJson = {
  pi?: { skills?: string[] };
};

const root = join(import.meta.dir, "..");
const repoRoot = join(root, "..", "..");
const manifestPath = join(root, "assets", "manifest.pi.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as PiManifest;
const failures: string[] = [];

function fail(message: string): void {
  failures.push(message);
}

function frontmatterName(markdown: string): string | null {
  const match = /^---\n([\s\S]*?)\n---/.exec(markdown);
  if (!match) return null;
  const name = /^name:\s*(.+?)\s*$/m.exec(match[1]);
  return name?.[1]?.replace(/^['"]|['"]$/g, "") ?? null;
}

function sameList(label: string, actual: string[], expected: string[]): void {
  const a = [...actual].sort();
  const e = [...expected].sort();
  if (JSON.stringify(a) !== JSON.stringify(e)) {
    fail(`${label} mismatch\n  actual:   ${a.join(", ")}\n  expected: ${e.join(", ")}`);
  }
}

if (manifest.schema_version !== "1.0") fail("manifest.pi schema_version must be 1.0");
if (manifest.host !== "pi") fail("manifest.pi host must be pi");

for (const skill of manifest.assets.skills) {
  const skillPath = join(root, "assets", "skills", skill, "SKILL.md");
  if (!existsSync(skillPath)) {
    fail(`missing skill asset: ${skillPath}`);
    continue;
  }
  const name = frontmatterName(readFileSync(skillPath, "utf8"));
  if (name !== skill) fail(`skill ${skill} frontmatter name is ${name ?? "missing"}`);
}

const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as PackageJson;
const piSkills = (pkg.pi?.skills ?? []).map(
  (entry) => entry.replace(/\/+$/, "").split("/").pop() ?? entry,
);
sameList("package.json pi.skills vs manifest.pi skills", piSkills, manifest.assets.skills);

if (!manifest.requires?.tools?.includes("subagent")) {
  fail("manifest.pi must declare the subagent tool dependency");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(`pi-accord skill validation passed (${manifest.assets.skills.length} skills)`);
