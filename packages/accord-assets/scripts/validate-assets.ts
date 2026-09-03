import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { agentSchemas, registeredAgentNames } from "@clive.shirley/accord-core/agents/registry.js";
import { loadBundledProviders } from "@clive.shirley/accord-core/integrations/provider-deps.js";

type Manifest = {
  schema_version: string;
  package: string;
  assets: {
    agents: string[];
    providers?: {
      trackers?: string[];
      enrichments?: string[];
    };
  };
};

const root = join(import.meta.dir, "..");
const coreRoot = join(root, "..", "accord-core");
const manifestPath = join(root, "manifest.json");
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
if (manifest.package !== "@clive.shirley/accord-assets") {
  fail("manifest package must be @clive.shirley/accord-assets");
}

const registryAgents = registeredAgentNames();
sameList("manifest agents vs registry", manifest.assets.agents, registryAgents);

for (const agent of manifest.assets.agents) {
  const agentPath = join(root, "agents", "accord", `${agent}.md`);
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
  const promptPath = join(root, "providers", "trackers", `${provider}.md`);
  const sidecarPath = join(root, "providers", "trackers", `${provider}.json`);
  if (!existsSync(promptPath)) fail(`missing tracker prompt: ${promptPath}`);
  if (!existsSync(sidecarPath)) fail(`missing tracker sidecar: ${sidecarPath}`);
}

for (const provider of enrichmentProviders) {
  const promptPath = join(root, "providers", "enrichments", `${provider}.md`);
  const sidecarPath = join(root, "providers", "enrichments", `${provider}.json`);
  if (!existsSync(promptPath)) fail(`missing enrichment prompt: ${promptPath}`);
  if (!existsSync(sidecarPath)) fail(`missing enrichment sidecar: ${sidecarPath}`);
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log(
  `accord-assets validation passed (${manifest.assets.agents.length} agents, ${trackerProviders.length + enrichmentProviders.length} providers)`,
);
