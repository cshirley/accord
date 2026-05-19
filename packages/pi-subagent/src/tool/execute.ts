import * as path from "node:path";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  type AgentConfig,
  type AgentScope,
  type ThinkingLevel,
  discoverAgents,
} from "../agents.js";
import { getFinalOutput } from "../spawn/output.js";
import type { SubagentResponseContract } from "../spawn/types.js";
import { mapWithConcurrencyLimit } from "./concurrency.js";
import { MAX_CONCURRENCY, MAX_PARALLEL_TASKS } from "./constants.js";
import { SubagentParams, type SubagentParams as SubagentParamsInput } from "./params.js";
import { SubagentRunError } from "../spawn/types.js";
import { runSingleAgent } from "./run-single.js";
import type { OnUpdateCallback, SingleResult, SubagentDetails } from "./types.js";

type SubagentToolDefinition = ToolDefinition<typeof SubagentParams, SubagentDetails>;

type ExecuteContext = Parameters<NonNullable<SubagentToolDefinition["execute"]>>[4];

type ExecuteResult = Awaited<ReturnType<NonNullable<SubagentToolDefinition["execute"]>>>;

function buildRunOptions(
  params: SubagentParamsInput,
  agentScope: AgentScope,
  overrides: {
    agentFile?: string;
    model?: string;
    thinking?: ThinkingLevel;
  } = {},
): Parameters<typeof runSingleAgent>[8] {
  return {
    agentFile: overrides.agentFile ?? params.agentFile,
    agentScope,
    model: overrides.model ?? params.model,
    thinking: (overrides.thinking ?? params.thinking) as ThinkingLevel | undefined,
    systemAppend: params.systemAppend,
    response: params.response as SubagentResponseContract | undefined,
    timeoutMs: params.timeoutMs,
  };
}

export async function executeSubagentTool(
  params: SubagentParamsInput,
  signal: AbortSignal | undefined,
  onUpdate: OnUpdateCallback | undefined,
  ctx: ExecuteContext,
): Promise<ExecuteResult> {
  const agentScope: AgentScope = params.agentScope ?? "user";
  const discovery = discoverAgents(ctx.cwd, agentScope);
  const agents = discovery.agents;
  const confirmProjectAgents = params.confirmProjectAgents ?? true;

  const hasChain = (params.chain?.length ?? 0) > 0;
  const hasTasks = (params.tasks?.length ?? 0) > 0;
  const hasSingle = Boolean(params.task && (params.agent || params.agentFile));
  const modeCount = Number(hasChain) + Number(hasTasks) + Number(hasSingle);

  const makeDetails =
    (mode: "single" | "parallel" | "chain") =>
    (results: SingleResult[]): SubagentDetails => ({
      mode,
      agentScope,
      projectAgentsDir: discovery.projectAgentsDir,
      results,
    });

  if (modeCount !== 1) {
    const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
    return {
      content: [
        {
          type: "text",
          text: `Invalid parameters. Provide exactly one mode.\nAvailable agents: ${available}`,
        },
      ],
      details: makeDetails("single")([]),
    };
  }

  if ((agentScope === "project" || agentScope === "both") && confirmProjectAgents && ctx.hasUI) {
    const requestedAgentNames = new Set<string>();
    if (params.chain) for (const step of params.chain) requestedAgentNames.add(step.agent);
    if (params.tasks) for (const t of params.tasks) requestedAgentNames.add(t.agent);
    if (params.agent) requestedAgentNames.add(params.agent);

    const projectAgentsRequested = Array.from(requestedAgentNames)
      .map((name) => agents.find((a) => a.name === name))
      .filter((a): a is AgentConfig => a?.source === "project");

    if (projectAgentsRequested.length > 0) {
      const names = projectAgentsRequested.map((a) => a.name).join(", ");
      const dir = discovery.projectAgentsDir ?? "(unknown)";
      const ok = await ctx.ui.confirm(
        "Run project-local agents?",
        `Agents: ${names}\nSource: ${dir}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
      );
      if (!ok)
        return {
          content: [{ type: "text", text: "Canceled: project-local agents not approved." }],
          details: makeDetails(hasChain ? "chain" : hasTasks ? "parallel" : "single")([]),
        };
    }
  }

  if (params.chain && params.chain.length > 0) {
    const results: SingleResult[] = [];
    let previousOutput = "";

    for (let i = 0; i < params.chain.length; i++) {
      const step = params.chain[i];
      const taskWithContext = step.task.replace(/\{previous\}/g, previousOutput);

      const chainUpdate: OnUpdateCallback | undefined = onUpdate
        ? (partial) => {
            const currentResult = partial.details?.results[0];
            if (currentResult) {
              const allResults = [...results, currentResult];
              onUpdate({
                content: partial.content,
                details: makeDetails("chain")(allResults),
              });
            }
          }
        : undefined;

      let result: SingleResult;
      try {
        result = await runSingleAgent(
          ctx.cwd,
          agents,
          step.agent,
          taskWithContext,
          step.cwd,
          i + 1,
          signal,
          chainUpdate,
          makeDetails("chain"),
          buildRunOptions(params, agentScope),
        );
      } catch (error) {
        if (error instanceof SubagentRunError) {
          return {
            content: [{ type: "text", text: error.message }],
            details: makeDetails("chain")(results),
            isError: true,
          } as ExecuteResult;
        }
        throw error;
      }
      results.push(result);

      const isError =
        result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
      if (isError) {
        const errorMsg =
          result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
        return {
          content: [
            {
              type: "text",
              text: `Chain stopped at step ${i + 1} (${step.agent}): ${errorMsg}`,
            },
          ],
          details: makeDetails("chain")(results),
          isError: true,
        } as ExecuteResult;
      }
      previousOutput = getFinalOutput(result.messages);
    }
    return {
      content: [
        {
          type: "text",
          text: getFinalOutput(results[results.length - 1].messages) || "(no output)",
        },
      ],
      details: makeDetails("chain")(results),
    };
  }

  if (params.tasks && params.tasks.length > 0) {
    if (params.tasks.length > MAX_PARALLEL_TASKS)
      return {
        content: [
          {
            type: "text",
            text: `Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
          },
        ],
        details: makeDetails("parallel")([]),
      };

    const allResults: SingleResult[] = new Array(params.tasks.length);

    for (let i = 0; i < params.tasks.length; i++) {
      allResults[i] = {
        agent: params.tasks[i].agent,
        agentSource: "unknown",
        task: params.tasks[i].task,
        exitCode: -1,
        messages: [],
        stderr: "",
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          cost: 0,
          contextTokens: 0,
          turns: 0,
        },
      };
    }

    const emitParallelUpdate = () => {
      if (onUpdate) {
        const running = allResults.filter((r) => r.exitCode === -1).length;
        const done = allResults.filter((r) => r.exitCode !== -1).length;
        onUpdate({
          content: [
            {
              type: "text",
              text: `Parallel: ${done}/${allResults.length} done, ${running} running...`,
            },
          ],
          details: makeDetails("parallel")([...allResults]),
        });
      }
    };

    const results = await mapWithConcurrencyLimit(
      params.tasks,
      MAX_CONCURRENCY,
      async (t, index) => {
        let result: SingleResult;
        try {
          result = await runSingleAgent(
            ctx.cwd,
            agents,
            t.agent,
            t.task,
            t.cwd,
            undefined,
            signal,
            (partial) => {
              if (partial.details?.results[0]) {
                allResults[index] = partial.details.results[0];
                emitParallelUpdate();
              }
            },
            makeDetails("parallel"),
            buildRunOptions(params, agentScope),
          );
        } catch (error) {
          if (error instanceof SubagentRunError) {
            result = {
              agent: t.agent,
              agentSource: "unknown",
              task: t.task,
              exitCode: error.result.exitCode,
              messages: error.result.messages,
              stderr: error.result.stderr || error.message,
              usage: error.result.usage,
              model: error.result.model,
              stopReason: error.result.stopReason,
              errorMessage: error.message,
            };
          } else {
            throw error;
          }
        }
        allResults[index] = result;
        emitParallelUpdate();
        return result;
      },
    );

    const successCount = results.filter((r) => r.exitCode === 0).length;
    const summaries = results.map((r) => {
      const output = getFinalOutput(r.messages);
      const preview = output.slice(0, 100) + (output.length > 100 ? "..." : "");
      return `[${r.agent}] ${r.exitCode === 0 ? "completed" : "failed"}: ${preview || "(no output)"}`;
    });
    return {
      content: [
        {
          type: "text",
          text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n")}`,
        },
      ],
      details: makeDetails("parallel")(results),
    };
  }

  if (params.task && (params.agent || params.agentFile)) {
    const agentName = params.agent ?? path.basename(params.agentFile as string, ".md");
    let result: SingleResult;
    try {
      result = await runSingleAgent(
        ctx.cwd,
        agents,
        agentName,
        params.task,
        params.cwd,
        undefined,
        signal,
        onUpdate,
        makeDetails("single"),
        buildRunOptions(params, agentScope),
      );
    } catch (error) {
      if (error instanceof SubagentRunError) {
        const failed = error.result;
        return {
          content: [{ type: "text", text: error.message }],
          details: makeDetails("single")([
            {
              agent: failed.agent,
              agentSource: failed.agentSource,
              task: failed.task,
              exitCode: failed.exitCode,
              messages: failed.messages,
              stderr: failed.stderr || error.message,
              usage: failed.usage,
              model: failed.model,
              stopReason: failed.stopReason,
              errorMessage: failed.errorMessage ?? error.message,
            },
          ]),
          isError: true,
        } as ExecuteResult;
      }
      throw error;
    }
    const isError =
      result.exitCode !== 0 || result.stopReason === "error" || result.stopReason === "aborted";
    if (isError) {
      const errorMsg =
        result.errorMessage || result.stderr || getFinalOutput(result.messages) || "(no output)";
      return {
        content: [{ type: "text", text: `Agent ${result.stopReason || "failed"}: ${errorMsg}` }],
        details: makeDetails("single")([result]),
        isError: true,
      } as ExecuteResult;
    }
    return {
      content: [{ type: "text", text: getFinalOutput(result.messages) || "(no output)" }],
      details: makeDetails("single")([result]),
    };
  }

  const available = agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
  return {
    content: [{ type: "text", text: `Invalid parameters. Available agents: ${available}` }],
    details: makeDetails("single")([]),
  };
}
