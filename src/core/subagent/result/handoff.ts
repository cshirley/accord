/**
 * Format subagent return packets for orchestrator handoff in tool results.
 */

export function formatPacketInjection(agentName: string, packet: unknown): string {
  return `\n\n## ${agentName} Return Packet\n\n\`\`\`json\n${JSON.stringify(packet, null, 2)}\n\`\`\`\n`;
}

export function formatMissingPacketWarning(agentName: string, resultKeys: string[]): string {
  const keys = resultKeys.sort().join(", ") || "(none)";
  return `\n⚠ Return packet missing for ${agentName}. Expected a final fenced \`\`\`json block matching its return schema. Result keys: ${keys}.`;
}

export function assembleHandoffContent(
  existingContent: unknown[] | undefined,
  contentAppend: string,
): { type: "text"; text: string }[] {
  const existingParts: string[] = [];
  if (Array.isArray(existingContent)) {
    for (const block of existingContent) {
      if (typeof block === "string") existingParts.push(block);
      else {
        const b = block as Record<string, unknown>;
        if (b.type === "text" && typeof b.text === "string") existingParts.push(b.text);
      }
    }
  }
  return [{ type: "text", text: existingParts.join("\n") + contentAppend }];
}

