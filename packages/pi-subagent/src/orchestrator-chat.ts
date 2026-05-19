/**
 * In-chat subagent progress for harness orchestration (/dev resume|finish).
 * Uses the same renderCall/renderResult as the registered subagent tool (ToolExecution-style box in the transcript).
 */

import { randomUUID } from "node:crypto";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  Theme,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Box, Container, Spacer, Text } from "@earendil-works/pi-tui";
import type { AgentScope } from "./agents.js";
import {
  type HarnessSubagentOnUpdate,
  type HarnessSubagentProgress,
  summarizeHarnessSubagentProgress,
} from "./progress.js";

export const ORCHESTRATOR_SUBAGENT_MESSAGE_TYPE = "accord-orchestrator-subagent";

type SubagentDetails = {
  mode: "single" | "parallel" | "chain";
  agentScope: AgentScope;
  projectAgentsDir: string | null;
  results: Array<{
    messages: import("@earendil-works/pi-ai").Message[];
    usage: { turns: number };
    exitCode?: number;
    agent?: string;
    task?: string;
  }>;
};

type OrchestratorSubagentMessageDetails = {
  toolCallId: string;
  label: string;
  callArgs: { agent: string; task: string; agentScope?: AgentScope };
};

type RunState = {
  toolCallId: string;
  label: string;
  callArgs: { agent: string; task: string; agentScope: AgentScope };
  toolResult: AgentToolResult<SubagentDetails> | null;
  rootComponent: OrchestratorSubagentRoot | undefined;
  theme: Theme | undefined;
  finalized: boolean;
  isError: boolean;
};

const runs = new Map<string, RunState>();

let subagentRenderCall: ToolDefinition["renderCall"] | undefined;
let subagentRenderResult: ToolDefinition["renderResult"] | undefined;

const STUB_RENDER_CONTEXT = {
  args: {},
  toolCallId: "",
  invalidate: () => {},
  lastComponent: undefined,
  state: {},
  cwd: "",
  executionStarted: true,
  argsComplete: true,
  isPartial: true,
  expanded: false,
  showImages: true,
  isError: false,
};

class OrchestratorSubagentChatRow extends Container {
  private readonly box: Box;
  private readonly callArgs: { agent: string; task: string; agentScope: AgentScope };
  private expanded: boolean;
  private isPartial = true;
  private isError = false;
  private toolResult: AgentToolResult<SubagentDetails> | null = null;

  constructor(
    callArgs: { agent: string; task: string; agentScope: AgentScope },
    expanded: boolean,
    theme: Theme,
  ) {
    super();
    this.callArgs = callArgs;
    this.expanded = expanded;
    this.addChild(new Spacer(1));
    this.box = new Box(1, 1, (text) => theme.bg("toolPendingBg", text));
    this.addChild(this.box);
    this.redraw(theme);
  }

  setExpanded(expanded: boolean, theme: Theme) {
    this.expanded = expanded;
    this.redraw(theme);
  }

  applyUpdate(partial: AgentToolResult<SubagentDetails>, theme: Theme) {
    this.toolResult = partial;
    this.isPartial = true;
    this.isError = false;
    this.box.setBgFn((text) => theme.bg("toolPendingBg", text));
    this.redraw(theme);
  }

  applyFinal(result: AgentToolResult<SubagentDetails>, theme: Theme, isError: boolean) {
    this.toolResult = result;
    this.isPartial = false;
    this.isError = isError;
    this.box.setBgFn((text) =>
      isError ? theme.bg("toolErrorBg", text) : theme.bg("toolSuccessBg", text),
    );
    this.redraw(theme);
  }

  private redraw(theme: Theme) {
    this.box.clear();
    if (subagentRenderCall) {
      try {
        const callComponent = subagentRenderCall(this.callArgs, theme, STUB_RENDER_CONTEXT);
        if (callComponent) this.box.addChild(callComponent);
      } catch {
        this.box.addChild(
          new Text(
            theme.fg("toolTitle", theme.bold("subagent ")) +
              theme.fg("accent", this.callArgs.agent),
            0,
            0,
          ),
        );
      }
    }
    if (this.toolResult && subagentRenderResult) {
      try {
        const resultComponent = subagentRenderResult(
          this.toolResult,
          { expanded: this.expanded, isPartial: this.isPartial },
          theme,
          STUB_RENDER_CONTEXT,
        );
        if (resultComponent) this.box.addChild(resultComponent);
      } catch {
        const text = this.toolResult.content[0];
        if (text?.type === "text") {
          this.box.addChild(new Text(theme.fg("toolOutput", text.text), 0, 0));
        }
      }
    } else if (this.isPartial) {
      this.box.addChild(new Text(theme.fg("muted", "(running…)"), 0, 0));
    }
  }
}

/** Root returned from the message renderer; supports live redraw via {@link invalidate}. */
class OrchestratorSubagentRoot extends Container {
  private readonly run: RunState;
  private chatRow: OrchestratorSubagentChatRow | undefined;
  private expanded = false;

  constructor(run: RunState) {
    super();
    this.run = run;
    run.rootComponent = this;
  }

  setExpanded(expanded: boolean, theme: Theme) {
    this.expanded = expanded;
    this.chatRow?.setExpanded(expanded, theme);
  }

  syncFromRun(theme: Theme) {
    if (!this.chatRow) {
      this.chatRow = new OrchestratorSubagentChatRow(this.run.callArgs, this.expanded, theme);
      this.clear();
      this.addChild(this.chatRow);
    }
    if (!this.run.toolResult) return;
    if (this.run.finalized) {
      this.chatRow.applyFinal(this.run.toolResult, theme, this.run.isError);
    } else {
      this.chatRow.applyUpdate(this.run.toolResult, theme);
    }
  }

  invalidate(): void {
    super.invalidate();
    const theme = this.run.theme;
    if (theme) {
      this.syncFromRun(theme);
    }
  }
}

/** Wire harness spawns to the subagent tool renderers (call after registerTool). */
type SubagentToolRenderers = {
  renderCall?: ToolDefinition["renderCall"];
  renderResult?: ToolDefinition["renderResult"];
};

export function registerOrchestratorSubagentChatRenderer(
  pi: ExtensionAPI,
  subagentTool: SubagentToolRenderers,
): void {
  subagentRenderCall = subagentTool.renderCall;
  subagentRenderResult = subagentTool.renderResult;

  pi.registerMessageRenderer(ORCHESTRATOR_SUBAGENT_MESSAGE_TYPE, (message, options, theme) => {
    const details = message.details as OrchestratorSubagentMessageDetails | undefined;
    if (!details?.toolCallId) {
      return new Text(theme.fg("muted", "(orchestrator subagent)"), 0, 0);
    }
    const run = runs.get(details.toolCallId);
    if (!run) {
      return new Text(theme.fg("muted", `${details.label}: starting…`), 0, 0);
    }
    run.theme = theme;
    const root = run.rootComponent ?? new OrchestratorSubagentRoot(run);
    root.setExpanded(options.expanded, theme);
    root.syncFromRun(theme);
    return root;
  });
}

export type OrchestratorSubagentChatHandle = {
  onUpdate: HarnessSubagentOnUpdate;
  dispose: () => void;
};

export type OrchestratorSubagentChatOptions = {
  label: string;
  agent: string;
  task: string;
  /** Called on each subprocess progress tick (e.g. setWidget + setWorkingMessage). */
  onProgress?: (progress: HarnessSubagentProgress) => void;
  /** Optional hook after the in-chat row invalidates (e.g. refresh footer/widget). */
  onUiRefresh?: () => void;
};

function notifyRunUiChanged(run: RunState): void {
  const theme = run.theme;
  if (theme && run.rootComponent) {
    run.rootComponent.syncFromRun(theme);
    run.rootComponent.invalidate();
  }
}

/** Post an in-chat tool-style row and stream updates via harnessSpawnSubagent onUpdate. */
export function startOrchestratorSubagentChatDisplay(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  options: OrchestratorSubagentChatOptions,
): OrchestratorSubagentChatHandle {
  const toolCallId = `accord-orch-${randomUUID()}`;
  const callArgs = { agent: options.agent, task: options.task, agentScope: "user" as const };
  runs.set(toolCallId, {
    toolCallId,
    label: options.label,
    callArgs,
    toolResult: null,
    rootComponent: undefined,
    theme: undefined,
    finalized: false,
    isError: false,
  });

  if (ctx.hasUI) {
    pi.sendMessage({
      customType: ORCHESTRATOR_SUBAGENT_MESSAGE_TYPE,
      content: `${options.label}: ${options.agent}`,
      display: true,
      details: {
        toolCallId,
        label: options.label,
        callArgs,
      } satisfies OrchestratorSubagentMessageDetails,
    });
  }

  return {
    onUpdate: (partial) => {
      const run = runs.get(toolCallId);
      if (!run) return;
      run.toolResult = partial as AgentToolResult<SubagentDetails>;
      const current = partial.details?.results[0];
      if (current && options.onProgress) {
        options.onProgress(summarizeHarnessSubagentProgress(options.agent, current));
      }
      // Footer/widget must refresh even before the custom message renderer assigns theme.
      options.onUiRefresh?.();
      notifyRunUiChanged(run);
    },
    dispose: () => {
      const run = runs.get(toolCallId);
      if (run) {
        if (run.toolResult && run.theme && run.rootComponent) {
          const exitCode = run.toolResult.details?.results?.[0]?.exitCode ?? 0;
          run.isError = exitCode !== 0;
          run.finalized = true;
          run.rootComponent.syncFromRun(run.theme);
          run.rootComponent.invalidate();
        }
        runs.delete(toolCallId);
      }
    },
  };
}
