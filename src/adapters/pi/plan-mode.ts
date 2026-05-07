export function isPlanModeActive(ctx: { sessionManager?: { getEntries?: () => unknown[] } }): boolean {
  const entries = ctx.sessionManager?.getEntries?.() || [];
  const planModeEntry = entries
    .filter((e) => {
      const entry = e as { type?: string; customType?: string };
      return entry.type === "custom" && entry.customType === "plan-mode";
    })
    .pop() as { data?: { enabled?: boolean } } | undefined;
  return planModeEntry?.data?.enabled === true;
}

export function planModeBlockMessage(): string {
  return [
    "ACCORD is blocked because plan mode is active.",
    "",
    "Run `/plan` to disable plan mode, then retry the harness command.",
    "Read-only commands still available: `/dev help`, `/dev tasks`, `/dev retro`.",
  ].join("\n");
}

export function planModeSubagentBlockReason(): string {
  return [
    "ACCORD subagent dispatch is blocked because plan mode is active.",
    "Run `/plan` to disable plan mode, then retry the harness command.",
    "This prevents phase agents from failing later on restricted tools.",
  ].join("\n");
}
