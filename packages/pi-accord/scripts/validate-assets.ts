import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { agentSchemas, registeredAgentNames } from "@clive.shirley/accord-core/agents/registry.js";
import { loadBundledProviders } from "@clive.shirley/accord-core/integrations/provider-deps.js";

type Manifest = {
  schema_version: string;
  host: string;
  assets: {
    skills: string[];
    agents: string[];
    providers?: {
      trackers?: string[];
      enrichments?: string[];
    };
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
const coreRoot = join(root, "..", "accord-core");
const repoRoot = join(root, "..", "..");
const manifestPath = join(root, "assets", "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Manifest;
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

if (manifest.schema_version !== "1.0") fail("manifest schema_version must be 1.0");
if (manifest.host !== "pi") fail("manifest host must be pi");

for (const skill of manifest.assets.skills) {
  const skillPath = join(root, "assets", "skills", skill, "SKILL.md");
  if (!existsSync(skillPath)) {
    fail(`missing skill asset: ${skillPath}`);
    continue;
  }
  const name = frontmatterName(readFileSync(skillPath, "utf8"));
  if (name !== skill) fail(`skill ${skill} frontmatter name is ${name ?? "missing"}`);
}

// The installer symlinks skills from the manifest, but Pi registers them from
// package.json `pi.skills`. Keep the two lists in lockstep so a skill can't be
// bundled-but-unregistered (or vice versa).
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")) as PackageJson;
const piSkills = (pkg.pi?.skills ?? []).map(
  (entry) => entry.replace(/\/+$/, "").split("/").pop() ?? entry,
);
sameList("package.json pi.skills vs manifest skills", piSkills, manifest.assets.skills);

const registryAgents = registeredAgentNames();
sameList("manifest agents vs registry", manifest.assets.agents, registryAgents);

for (const agent of manifest.assets.agents) {
  const agentPath = join(root, "assets", "agents", "accord", `${agent}.md`);
  if (!existsSync(agentPath)) {
    fail(`missing agent asset: ${agentPath}`);
    continue;
  }
  const name = frontmatterName(readFileSync(agentPath, "utf8"));
  if (name !== agent) fail(`agent ${agent} frontmatter name is ${name ?? "missing"}`);

  for (const schema of agentSchemas(agent)) {
    const schemaPath = join(coreRoot, "schemas", schema);
    if (!existsSync(schemaPath)) fail(`agent ${agent} references missing schema: ${schema}`);
  }
}

const trackerProviders = manifest.assets.providers?.trackers ?? [];
const enrichmentProviders = manifest.assets.providers?.enrichments ?? [];
const bundled = loadBundledProviders();
sameList("manifest tracker providers vs sidecars", trackerProviders, [...bundled.trackers.keys()]);
sameList("manifest enrichment providers vs sidecars", enrichmentProviders, [
  ...bundled.enrichments.keys(),
]);

for (const provider of trackerProviders) {
  const promptPath = join(root, "assets", "providers", "trackers", `${provider}.md`);
  const sidecarPath = join(root, "assets", "providers", "trackers", `${provider}.json`);
  if (!existsSync(promptPath)) fail(`missing tracker prompt: ${promptPath}`);
  if (!existsSync(sidecarPath)) fail(`missing tracker sidecar: ${sidecarPath}`);
}

for (const provider of enrichmentProviders) {
  const promptPath = join(root, "assets", "providers", "enrichments", `${provider}.md`);
  const sidecarPath = join(root, "assets", "providers", "enrichments", `${provider}.json`);
  if (!existsSync(promptPath)) fail(`missing enrichment prompt: ${promptPath}`);
  if (!existsSync(sidecarPath)) fail(`missing enrichment sidecar: ${sidecarPath}`);
}

if (!manifest.requires?.tools?.includes("subagent")) {
  fail("manifest must declare the subagent tool dependency");
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(
  `asset validation passed (${manifest.assets.skills.length} skills, ${manifest.assets.agents.length} agents, ${trackerProviders.length + enrichmentProviders.length} providers)`,
);
