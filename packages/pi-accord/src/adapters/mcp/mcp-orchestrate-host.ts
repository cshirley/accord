/**
 * MCP orchestration host — resolves ACCORD_MCP_HARNESS and runs accord-cli commands.
 */

import {
  type AgentHarnessId,
  createCliContext,
  createHarness,
  parseHarnessId,
  runFinishCommand,
  runResumeCommand,
} from "@clive.shirley/accord-cli";
import type { DevHarnessConfig } from "@clive.shirley/accord-core/config/index.js";
import type {
  DevOrchestrateCommand,
  DevOrchestrateExecutionResult,
  DevOrchestrateHostHints,
} from "@clive.shirley/accord-core/orchestration/plan.js";
import type { ToolHandlerContext } from "@clive.shirley/accord-core/tools/types.js";
import type { HarnessMutableState } from "@clive.shirley/accord-core/types/host.js";

export type McpOrchestrateHostOptions = {
  cwd: string;
  getConfig: () => DevHarnessConfig | null;
  state: HarnessMutableState;
};

export function resolveMcpHarnessId(): AgentHarnessId | undefined {
  const raw = process.env.ACCORD_MCP_HARNESS?.trim();
  if (!raw) {
    return undefined;
  }
  try {
    return parseHarnessId(raw);
  } catch {
    console.error(
      `[accord:mcp] Invalid ACCORD_MCP_HARNESS="${raw}" — expected pi or exec. Plan-only mode.`,
    );
    return undefined;
  }
}

export function createMcpOrchestrateHostHints(
  harnessId: AgentHarnessId | undefined,
): DevOrchestrateHostHints {
  if (!harnessId) {
    return { programmatic_spawn_supported: false };
  }
  return {
    harness: harnessId,
    programmatic_spawn_supported: true,
    execute_by_default: true,
  };
}

export function createMcpOrchestrateToolContext(
  options: McpOrchestrateHostOptions,
  harnessId: AgentHarnessId | undefined,
): Pick<ToolHandlerContext, "getOrchestrateHostHints" | "executeOrchestration"> {
  if (!harnessId) {
    return {
      getOrchestrateHostHints: () => createMcpOrchestrateHostHints(undefined),
    };
  }

  const hints = createMcpOrchestrateHostHints(harnessId);

  return {
    getOrchestrateHostHints: () => hints,
    executeOrchestration: async (command: DevOrchestrateCommand, workItemId: string) => {
      options.state.devConfig = options.getConfig();
      const cliCtx = createCliContext(options.cwd);
      cliCtx.state = options.state;
      cliCtx.devConfig = options.state.devConfig;

      const harness = createHarness(harnessId, cliCtx, {
        autoConfirm: true,
        spawnNotifyLabel: `mcp:${command}`,
      });

      if (command === "resume") {
        const result = await runResumeCommand(cliCtx, harness, workItemId);
        return toExecutionResult(result);
      }

      const result = await runFinishCommand(cliCtx, harness, workItemId);
      return toExecutionResult(result);
    },
  };
}

function toExecutionResult(result: {
  exitCode: number;
  stalledReason?: "repeat_spawn" | "needs_input";
  closeoutOk?: boolean;
  workflowCostFormatted?: string;
}): DevOrchestrateExecutionResult {
  return {
    exit_code: result.exitCode,
    ...(result.stalledReason ? { stalled_reason: result.stalledReason } : {}),
    ...(result.closeoutOk !== undefined ? { closeout_ok: result.closeoutOk } : {}),
    ...(result.workflowCostFormatted
      ? { workflow_cost_formatted: result.workflowCostFormatted }
      : {}),
  };
}

export function createMcpHarnessState(
  getConfig: () => DevHarnessConfig | null,
): HarnessMutableState {
  return {
    devConfig: getConfig(),
    costCache: new Map(),
    sessionCost: 0,
    activeWorkItem: null,
  };
}
