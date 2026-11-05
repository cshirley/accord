import { loadDevHarnessConfig } from "@clive.shirley/accord-core/config/agents-md.js";
import { initFeatures } from "@clive.shirley/accord-core/knowledge/query.js";
import { ACCORD_TOOLS } from "@clive.shirley/accord-core/tools/registry.js";

export type FeatureCommandOptions = { json?: boolean; depth?: string };

type ToolResult = { ok: boolean; text: string; details?: unknown };

async function runTool(
  name: string,
  params: Record<string, unknown>,
  cwd: string,
): Promise<ToolResult> {
  const found = ACCORD_TOOLS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`tool ${name} not registered`);
  const config = loadDevHarnessConfig(cwd);
  return (await found.handler(
    { ...params, cwd } as never,
    {
      getConfig: () => config,
    } as never,
  )) as unknown as ToolResult;
}

function emit(result: ToolResult, json: boolean | undefined): number {
  if (json && result.ok) console.log(JSON.stringify(result.details));
  else console.log(result.text);
  return result.ok ? 0 : 1;
}

export async function runFeatureCommand(
  verb: "find" | "impact" | "init",
  args: string[],
  cwd: string,
  options: FeatureCommandOptions = {},
): Promise<number> {
  if (verb === "impact") {
    return emit(await runTool("dev_feature_impact", { id: args[0] }, cwd), options.json);
  }
  if (verb === "find") {
    const target = args[0] ?? "";
    const params: Record<string, unknown> = target.includes("/")
      ? { path: target }
      : { query: target };
    if (options.depth) params.depth = options.depth;
    return emit(await runTool("dev_feature_find", params, cwd), options.json);
  }
  const config = loadDevHarnessConfig(cwd);
  if (!config?.knowledge?.enabled) {
    return emit(await runTool("dev_feature_find", { query: "init" }, cwd), false);
  }
  const { index } = initFeatures({ repoRoot: cwd, root: config.knowledge.root });
  console.log(`Feature index ready: ${index}`);
  return 0;
}
