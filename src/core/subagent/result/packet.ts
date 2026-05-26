/**
 * Return-packet extraction from subagent tool rows and assistant text.
 */

/**
 * Scan `text` for balanced top-level `{...}` regions and return them in
 * source order. Strings (with escapes) are skipped so braces inside strings
 * don't unbalance the scanner. This is O(n) and avoids the catastrophic
 * backtracking of the previous greedy regex approach.
 */
export function findBalancedJsonRegions(text: string): string[] {
  const regions: string[] = [];
  const len = text.length;
  let i = 0;
  while (i < len) {
    if (text.charCodeAt(i) !== 0x7b /* { */) {
      i++;
      continue;
    }
    const start = i;
    let depth = 0;
    let inString = false;
    let nextCharEscaped = false;
    let scanIndex = i;
    for (; scanIndex < len; scanIndex++) {
      const ch = text.charCodeAt(scanIndex);
      if (inString) {
        if (nextCharEscaped) {
          nextCharEscaped = false;
          continue;
        }
        if (ch === 0x5c /* \ */) {
          nextCharEscaped = true;
          continue;
        }
        if (ch === 0x22 /* " */) inString = false;
        continue;
      }
      if (ch === 0x22 /* " */) {
        inString = true;
        continue;
      }
      if (ch === 0x7b /* { */) {
        depth++;
        continue;
      }
      if (ch === 0x7d /* } */) {
        depth--;
        if (depth === 0) {
          regions.push(text.slice(start, scanIndex + 1));
          break;
        }
      }
    }
    if (depth === 0 && scanIndex < len) {
      i = scanIndex + 1;
    } else {
      // Unbalanced from this `{`; advance by one to avoid quadratic rescans.
      i = start + 1;
    }
  }
  return regions;
}

export function extractReturnPacket(text: string): Record<string, unknown> | null {
  if (!text) return null;
  // Fenced code block first; bounded match avoids any backtracking risk.
  const fencedMatch = text.match(/```json\s*\n([\s\S]*?)\n```/);
  if (fencedMatch) {
    const body = fencedMatch[1];
    if (body !== undefined) {
      try {
        const parsed: unknown = JSON.parse(body);
        if (parsed && typeof parsed === "object") {
          return parsed as Record<string, unknown>;
        }
      } catch {
        /* fall through */
      }
    }
  }
  // Walk balanced {...} regions from the end and accept the last one with
  // a recognised packet key.
  const regions = findBalancedJsonRegions(text);
  for (let i = regions.length - 1; i >= 0; i--) {
    const region = regions[i];
    if (region === undefined) continue;
    try {
      const parsed: unknown = JSON.parse(region);
      if (parsed && typeof parsed === "object" && ("status" in parsed || "verdict" in parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* try the next region */
    }
  }
  return null;
}

function contentBlocksToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part: unknown) => {
      if (typeof part === "string") return part;
      const p = part as Record<string, unknown>;
      if (p.type === "text" && typeof p.text === "string") return p.text;
      if (typeof p.text === "string") return p.text;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

/** Prose before the final fenced ```json return block (subagent analysis / narrative). */
export function extractAnalysisFromAssistantText(text: string): string | undefined {
  if (!text) {
    return undefined;
  }
  const withoutFence = text.replace(/```json\s*\n[\s\S]*?\n```/g, "").trim();
  return withoutFence.length > 0 ? withoutFence : undefined;
}

export function extractAnalysisFromSubagentResult(result: unknown): string | undefined {
  const r = result as Record<string, unknown>;
  const candidates: string[] = [];

  if (Array.isArray(r.messages)) {
    const assistantMessages = [...r.messages].filter(
      (m: unknown) => (m as { role?: string }).role === "assistant",
    );
    const last = assistantMessages[assistantMessages.length - 1];
    if (last) {
      const text = contentBlocksToText((last as { content?: unknown }).content);
      if (text) {
        candidates.push(text);
      }
    }
  }

  for (const key of ["content", "output", "text", "response", "result", "final", "finalResponse"]) {
    const value = r[key];
    if (typeof value === "string") {
      candidates.push(value);
    } else {
      const text = contentBlocksToText(value);
      if (text) {
        candidates.push(text);
      }
    }
  }

  for (const text of candidates) {
    const analysis = extractAnalysisFromAssistantText(text);
    if (analysis) {
      return analysis;
    }
  }
  return undefined;
}

export function extractReturnPacketFromSubagentResult(
  result: unknown,
): Record<string, unknown> | null {
  const r = result as Record<string, unknown>;

  const parsedReturn = r.parsedReturn;
  if (parsedReturn && typeof parsedReturn === "object" && !Array.isArray(parsedReturn)) {
    return parsedReturn as Record<string, unknown>;
  }

  const candidates: string[] = [];

  if (Array.isArray(r.messages)) {
    const assistantMessages = [...r.messages]
      .reverse()
      .filter((m: unknown) => (m as { role?: string }).role === "assistant");
    for (const msg of assistantMessages) {
      const text = contentBlocksToText((msg as { content?: unknown }).content);
      if (text) candidates.push(text);
    }
  }

  for (const key of ["content", "output", "text", "response", "result", "final", "finalResponse"]) {
    const value = r[key];
    if (typeof value === "string") candidates.push(value);
    else {
      const text = contentBlocksToText(value);
      if (text) candidates.push(text);
    }
  }

  const message = r.message as { content?: unknown } | undefined;
  const messageText = contentBlocksToText(message?.content);
  if (messageText) candidates.push(messageText);

  for (const text of candidates) {
    const packet = extractReturnPacket(text);
    if (packet) return packet;
  }
  return null;
}
