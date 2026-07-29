import { describe, expect, test } from "bun:test";
import {
  bashMutatedPaths,
  callPath,
  dedupeKey,
  type PlanMessage,
  type PruningConfig,
  type PruningInput,
  type PruningState,
  planPruning,
  protectedFrom,
  renderStub,
  type ToolCallInfo,
} from "../packages/pi-thrift/src/policy.js";

const CONFIG: PruningConfig = {
  keepRecentTurns: 3,
  stubThresholdBytes: 400,
  lowWaterPercent: 55,
  highWaterPercent: 75,
  minReclaimPercent: 8,
  assumedContextWindowTokens: 128_000,
  prunableTools: new Set(["bash", "read", "grep", "find", "ls"]),
};

const WINDOW = 200_000;

/** Tool results big enough to clear `minReclaimPercent`. Below that guard the
 *  planner deliberately refuses to engage, so fixtures that need engagement
 *  have to carry a realistic amount of reclaimable output. */
const BULKY = 30_000;

function freshState(): PruningState {
  return { decisions: new Map(), engaged: false };
}

/** Builds a conversation of `turns` turns, each a user message, an assistant
 *  message and one tool result of `bytes`. */
function conversation(
  turns: number,
  bytes: number,
  toolName = "read",
): { messages: PlanMessage[]; calls: Map<string, ToolCallInfo> } {
  const messages: PlanMessage[] = [];
  const calls = new Map<string, ToolCallInfo>();

  for (let t = 0; t < turns; t++) {
    const id = `call-${t}`;
    messages.push({ role: "user", bytes: 50 });
    messages.push({ role: "assistant", bytes: 50 });
    messages.push({ role: "toolResult", toolCallId: id, toolName, bytes });
    calls.set(id, { name: toolName, arguments: { path: `src/file${t}.ts` } });
  }

  return { messages, calls };
}

function run(overrides: Partial<PruningInput>): ReturnType<typeof planPruning> {
  const base = conversation(10, BULKY);
  return planPruning({
    messages: base.messages,
    calls: base.calls,
    pressure: { tokens: 0, contextWindow: WINDOW },
    config: CONFIG,
    state: freshState(),
    ...overrides,
  });
}

describe("dedupeKey", () => {
  test("is stable regardless of argument order", () => {
    expect(dedupeKey("read", { path: "a.ts", limit: 5 })).toBe(
      dedupeKey("read", { limit: 5, path: "a.ts" }),
    );
  });

  test("distinguishes different arguments", () => {
    expect(dedupeKey("read", { path: "a.ts" })).not.toBe(dedupeKey("read", { path: "b.ts" }));
  });
});

describe("callPath", () => {
  test("finds the target file across argument spellings", () => {
    expect(callPath({ name: "read", arguments: { path: "a.ts" } })).toBe("a.ts");
    expect(callPath({ name: "edit", arguments: { file_path: "b.ts" } })).toBe("b.ts");
    expect(callPath({ name: "bash", arguments: { command: "ls" } })).toBeUndefined();
  });
});

describe("protectedFrom", () => {
  test("protects the whole conversation when history is short", () => {
    const { messages } = conversation(2, 1_000);
    expect(protectedFrom(messages, 3)).toBe(0);
  });

  test("returns the start of the trailing window", () => {
    const { messages } = conversation(10, 1_000);
    const cutoff = protectedFrom(messages, 3);

    expect(messages[cutoff]?.role).toBe("user");
    expect(cutoff).toBeLessThan(messages.length);
  });
});

describe("pressure gating", () => {
  test("elides nothing while context is below the low-water mark", () => {
    const plan = run({ pressure: { tokens: WINDOW * 0.2, contextWindow: WINDOW } });

    expect(plan.stubbed).toBe(0);
    expect(plan.engaged).toBe(false);
    expect(plan.reason).toBe("below-low-water");
  });

  test("engages once context crosses the high-water mark", () => {
    const plan = run({ pressure: { tokens: WINDOW * 0.8, contextWindow: WINDOW } });

    expect(plan.engaged).toBe(true);
    expect(plan.reason).toBe("engaged");
    expect(plan.stubbed).toBeGreaterThan(0);
  });

  test("stays idle in the band when it was never engaged", () => {
    const plan = run({ pressure: { tokens: WINDOW * 0.65, contextWindow: WINDOW } });

    expect(plan.engaged).toBe(false);
    expect(plan.stubbed).toBe(0);
  });

  test("engages at exactly the high-water mark", () => {
    const plan = run({ pressure: { tokens: 150_000, contextWindow: WINDOW } });

    expect(plan.percent).toBe(CONFIG.highWaterPercent);
    expect(plan.engaged).toBe(true);
  });

  test("stays engaged between the marks once triggered, giving hysteresis", () => {
    const { messages, calls } = conversation(10, BULKY);
    const hot = planPruning({
      messages,
      calls,
      pressure: { tokens: WINDOW * 0.8, contextWindow: WINDOW },
      config: CONFIG,
      state: freshState(),
    });

    const cooling = planPruning({
      messages,
      calls,
      pressure: { tokens: WINDOW * 0.65, contextWindow: WINDOW },
      config: CONFIG,
      state: { decisions: hot.decisions, engaged: hot.engaged },
    });

    expect(cooling.engaged).toBe(true);
  });

  test("releases once pressure falls back under the low-water mark", () => {
    const { messages, calls } = conversation(10, BULKY);
    const hot = planPruning({
      messages,
      calls,
      pressure: { tokens: WINDOW * 0.8, contextWindow: WINDOW },
      config: CONFIG,
      state: freshState(),
    });
    expect(hot.engaged).toBe(true);

    const released = planPruning({
      messages,
      calls,
      pressure: { tokens: WINDOW * 0.4, contextWindow: WINDOW },
      config: CONFIG,
      state: { decisions: hot.decisions, engaged: hot.engaged },
    });

    expect(released.engaged).toBe(false);
    expect(released.reason).toBe("below-low-water");
  });

  test("releases at exactly the low-water mark, so the latch cannot stick", () => {
    const { messages, calls } = conversation(10, BULKY);
    const hot = planPruning({
      messages,
      calls,
      pressure: { tokens: WINDOW * 0.8, contextWindow: WINDOW },
      config: CONFIG,
      state: freshState(),
    });

    const atMark = planPruning({
      messages,
      calls,
      pressure: { tokens: 110_000, contextWindow: WINDOW },
      config: CONFIG,
      state: { decisions: hot.decisions, engaged: hot.engaged },
    });

    expect(atMark.percent).toBe(CONFIG.lowWaterPercent);
    expect(atMark.engaged).toBe(false);
  });

  test("does not re-engage in the band after releasing", () => {
    const { messages, calls } = conversation(10, BULKY);
    const hot = planPruning({
      messages,
      calls,
      pressure: { tokens: WINDOW * 0.8, contextWindow: WINDOW },
      config: CONFIG,
      state: freshState(),
    });
    const released = planPruning({
      messages,
      calls,
      pressure: { tokens: WINDOW * 0.4, contextWindow: WINDOW },
      config: CONFIG,
      state: { decisions: hot.decisions, engaged: hot.engaged },
    });

    const rewarming = planPruning({
      messages,
      calls,
      pressure: { tokens: WINDOW * 0.65, contextWindow: WINDOW },
      config: CONFIG,
      state: { decisions: released.decisions, engaged: released.engaged },
    });

    expect(rewarming.engaged).toBe(false);
  });

  test("holds steady when the host cannot report context size", () => {
    const plan = run({ pressure: { tokens: null, contextWindow: WINDOW } });

    expect(plan.stubbed).toBe(0);
    expect(plan.reason).toBe("usage-unknown");
    expect(plan.percent).toBeNull();
  });

  test("refuses to engage when there is too little to reclaim", () => {
    const { messages, calls } = conversation(10, 5_000);
    const plan = planPruning({
      messages,
      calls,
      pressure: { tokens: WINDOW * 0.8, contextWindow: WINDOW },
      config: CONFIG,
      state: freshState(),
    });

    expect(plan.reason).toBe("reclaim-too-small");
    expect(plan.engaged).toBe(false);
    expect(plan.stubbed).toBe(0);
  });

  test("engages once the same conversation has enough to reclaim", () => {
    const { messages, calls } = conversation(10, BULKY);
    const plan = planPruning({
      messages,
      calls,
      pressure: { tokens: WINDOW * 0.8, contextWindow: WINDOW },
      config: CONFIG,
      state: freshState(),
    });

    expect(plan.reason).toBe("engaged");
  });
});

describe("pressure estimation", () => {
  test("measures the conversation when the host exposes no usage API", () => {
    const plan = run({ pressure: null });

    expect(plan.estimated).toBe(true);
    expect(plan.percent).not.toBeNull();
  });

  test("a modest conversation elides nothing, rather than pruning on every turn", () => {
    // 10 turns of 30KB is ~75k tokens against the assumed 128k window: inside
    // the band, so the old "no usage API means stub everything" rule would have
    // pruned here and the watermarks must not.
    const plan = run({ pressure: null });

    expect(plan.stubbed).toBe(0);
    expect(plan.reason).toBe("below-low-water");
  });

  test("a conversation past the assumed window still engages", () => {
    const { messages, calls } = conversation(30, BULKY);
    const plan = planPruning({
      messages,
      calls,
      pressure: null,
      config: CONFIG,
      state: freshState(),
    });

    expect(plan.estimated).toBe(true);
    expect(plan.engaged).toBe(true);
    expect(plan.stubbed).toBeGreaterThan(0);
  });

  test("a host-reported reading is not marked as estimated", () => {
    const plan = run({ pressure: { tokens: WINDOW * 0.8, contextWindow: WINDOW } });

    expect(plan.estimated).toBe(false);
    expect(plan.percent).toBeCloseTo(80);
  });
});

describe("protected window", () => {
  test("never elides results inside the recent turns, even under pressure", () => {
    const { messages, calls } = conversation(10, BULKY);
    const plan = planPruning({
      messages,
      calls,
      pressure: { tokens: WINDOW * 0.95, contextWindow: WINDOW },
      config: CONFIG,
      state: freshState(),
    });

    const cutoff = protectedFrom(messages, CONFIG.keepRecentTurns);
    for (let i = cutoff; i < messages.length; i++) {
      const id = messages[i]?.toolCallId;
      if (id === undefined) continue;
      expect(plan.decisions.get(id)).not.toBe("stub");
    }
  });
});

describe("supersession", () => {
  test("collapses identical repeated calls regardless of pressure", () => {
    const messages: PlanMessage[] = [];
    const calls = new Map<string, ToolCallInfo>();

    for (let t = 0; t < 4; t++) {
      const id = `call-${t}`;
      messages.push({ role: "user", bytes: 50 });
      messages.push({ role: "assistant", bytes: 50 });
      messages.push({ role: "toolResult", toolCallId: id, toolName: "read", bytes: 5_000 });
      calls.set(id, { name: "read", arguments: { path: "src/same.ts" } });
    }

    const plan = planPruning({
      messages,
      calls,
      pressure: { tokens: 10, contextWindow: WINDOW },
      config: CONFIG,
      state: freshState(),
    });

    expect(plan.superseded).toBe(3);
    expect(plan.decisions.get("call-3")).not.toBe("superseded");
    expect(plan.stubbed).toBe(0);
  });

  test("drops reads invalidated by a later write to the same path", () => {
    const messages: PlanMessage[] = [
      { role: "user", bytes: 50 },
      { role: "assistant", bytes: 50 },
      { role: "toolResult", toolCallId: "read-1", toolName: "read", bytes: 5_000 },
      { role: "assistant", bytes: 50 },
      { role: "toolResult", toolCallId: "edit-1", toolName: "edit", bytes: 100 },
      { role: "user", bytes: 50 },
    ];
    const calls = new Map<string, ToolCallInfo>([
      ["read-1", { name: "read", arguments: { path: "src/a.ts" } }],
      ["edit-1", { name: "edit", arguments: { path: "src/a.ts" } }],
    ]);

    const plan = planPruning({
      messages,
      calls,
      pressure: { tokens: 10, contextWindow: WINDOW },
      config: CONFIG,
      state: freshState(),
    });

    expect(plan.decisions.get("read-1")).toBe("superseded");
  });

  test("keeps a read whose file was never modified", () => {
    const { messages, calls } = conversation(1, 5_000);
    const plan = planPruning({
      messages,
      calls,
      pressure: { tokens: 10, contextWindow: WINDOW },
      config: CONFIG,
      state: freshState(),
    });

    expect(plan.superseded).toBe(0);
  });

  test("keeps repeated bash runs, where the earlier output is the comparison", () => {
    const messages: PlanMessage[] = [];
    const calls = new Map<string, ToolCallInfo>();

    for (let t = 0; t < 4; t++) {
      const id = `run-${t}`;
      messages.push({ role: "user", bytes: 50 });
      messages.push({ role: "assistant", bytes: 50 });
      messages.push({ role: "toolResult", toolCallId: id, toolName: "bash", bytes: 5_000 });
      calls.set(id, { name: "bash", arguments: { command: "bun test" } });
    }

    const plan = planPruning({
      messages,
      calls,
      pressure: { tokens: 10, contextWindow: WINDOW },
      config: CONFIG,
      state: freshState(),
    });

    expect(plan.superseded).toBe(0);
  });

  test("drops a read invalidated by a later shell rewrite of the same file", () => {
    const messages: PlanMessage[] = [
      { role: "user", bytes: 50 },
      { role: "assistant", bytes: 50 },
      { role: "toolResult", toolCallId: "read-1", toolName: "read", bytes: 5_000 },
      { role: "assistant", bytes: 50 },
      { role: "toolResult", toolCallId: "sh-1", toolName: "bash", bytes: 100 },
      { role: "user", bytes: 50 },
    ];
    const calls = new Map<string, ToolCallInfo>([
      ["read-1", { name: "read", arguments: { path: "src/a.ts" } }],
      ["sh-1", { name: "bash", arguments: { command: "sed -i '' 's/x/y/' src/a.ts" } }],
    ]);

    const plan = planPruning({
      messages,
      calls,
      pressure: { tokens: 10, contextWindow: WINDOW },
      config: CONFIG,
      state: freshState(),
    });

    expect(plan.decisions.get("read-1")).toBe("superseded");
  });

  test("keeps a read that a later shell command only inspected", () => {
    const messages: PlanMessage[] = [
      { role: "user", bytes: 50 },
      { role: "assistant", bytes: 50 },
      { role: "toolResult", toolCallId: "read-1", toolName: "read", bytes: 5_000 },
      { role: "assistant", bytes: 50 },
      { role: "toolResult", toolCallId: "sh-1", toolName: "bash", bytes: 100 },
      { role: "user", bytes: 50 },
    ];
    const calls = new Map<string, ToolCallInfo>([
      ["read-1", { name: "read", arguments: { path: "src/a.ts" } }],
      ["sh-1", { name: "bash", arguments: { command: "grep -n todo src/a.ts > /dev/null" } }],
    ]);

    const plan = planPruning({
      messages,
      calls,
      pressure: { tokens: 10, contextWindow: WINDOW },
      config: CONFIG,
      state: freshState(),
    });

    expect(plan.superseded).toBe(0);
  });
});

describe("bashMutatedPaths", () => {
  const tracked = new Set(["src/a.ts", "docs/notes.md"]);

  test("names the target of a redirect", () => {
    expect(bashMutatedPaths("echo hi > src/a.ts", tracked)).toEqual(["src/a.ts"]);
    expect(bashMutatedPaths("cat x >> docs/notes.md", tracked)).toEqual(["docs/notes.md"]);
  });

  test("ignores a file that was only read past on the way to a redirect", () => {
    expect(bashMutatedPaths("grep -n todo src/a.ts > /dev/null", tracked)).toEqual([]);
  });

  test("names files touched by destructive verbs", () => {
    expect(bashMutatedPaths("rm -f src/a.ts", tracked)).toEqual(["src/a.ts"]);
    expect(bashMutatedPaths("sed -i '' 's/a/b/' src/a.ts", tracked)).toEqual(["src/a.ts"]);
    expect(bashMutatedPaths("mv src/a.ts src/b.ts", tracked)).toEqual(["src/a.ts"]);
  });

  test("leaves ordinary commands alone", () => {
    expect(bashMutatedPaths("bun test", tracked)).toEqual([]);
    expect(bashMutatedPaths("git status", tracked)).toEqual([]);
    expect(bashMutatedPaths("bun run build src/a.ts", tracked)).toEqual([]);
  });
});

describe("eligibility", () => {
  test("never elides error results", () => {
    const messages: PlanMessage[] = [
      { role: "user", bytes: 50 },
      { role: "toolResult", toolCallId: "e", toolName: "bash", isError: true, bytes: 9_000 },
      ...conversation(5, 5_000).messages,
    ];

    const plan = planPruning({
      messages,
      calls: new Map(),
      pressure: { tokens: WINDOW * 0.95, contextWindow: WINDOW },
      config: CONFIG,
      state: freshState(),
    });

    expect(plan.decisions.get("e")).toBeUndefined();
  });

  test("ignores results below the stub threshold", () => {
    const { messages, calls } = conversation(10, 100);
    const plan = planPruning({
      messages,
      calls,
      pressure: { tokens: WINDOW * 0.95, contextWindow: WINDOW },
      config: CONFIG,
      state: freshState(),
    });

    expect(plan.stubbed).toBe(0);
  });

  test("ignores tools not configured as prunable", () => {
    const { messages, calls } = conversation(10, 5_000, "some_custom_tool");
    const plan = planPruning({
      messages,
      calls,
      pressure: { tokens: WINDOW * 0.95, contextWindow: WINDOW },
      config: CONFIG,
      state: freshState(),
    });

    expect(plan.stubbed).toBe(0);
  });
});

describe("monotonicity", () => {
  function stubbedIdsOf(plan: ReturnType<typeof planPruning>): string[] {
    return [...plan.decisions.entries()].filter(([, d]) => d === "stub").map(([id]) => id);
  }

  test("holds elisions while still engaged and pressure is easing", () => {
    const { messages, calls } = conversation(10, BULKY);

    const hot = planPruning({
      messages,
      calls,
      pressure: { tokens: WINDOW * 0.9, contextWindow: WINDOW },
      config: CONFIG,
      state: freshState(),
    });
    const stubbed = stubbedIdsOf(hot);
    expect(stubbed.length).toBeGreaterThan(0);

    // 0.6 is inside the band, so the planner is still engaged and running the
    // stubbing loop. This is the path that could flip a decision back; the low
    // pressure case below never reaches it.
    const easing = planPruning({
      messages,
      calls,
      pressure: { tokens: WINDOW * 0.6, contextWindow: WINDOW },
      config: CONFIG,
      state: { decisions: hot.decisions, engaged: hot.engaged },
    });

    expect(easing.engaged).toBe(true);
    for (const id of stubbed) {
      expect(easing.decisions.get(id)).toBe("stub");
    }
  });

  test("holds elisions after the pressure that caused them is gone", () => {
    const { messages, calls } = conversation(10, BULKY);

    const hot = planPruning({
      messages,
      calls,
      pressure: { tokens: WINDOW * 0.9, contextWindow: WINDOW },
      config: CONFIG,
      state: freshState(),
    });
    const stubbed = stubbedIdsOf(hot);

    const cold = planPruning({
      messages,
      calls,
      pressure: { tokens: WINDOW * 0.1, contextWindow: WINDOW },
      config: CONFIG,
      state: { decisions: hot.decisions, engaged: hot.engaged },
    });

    expect(cold.engaged).toBe(false);
    for (const id of stubbed) {
      expect(cold.decisions.get(id)).toBe("stub");
    }
  });

  test("a caller that drops the decisions is free to restore, which is what the\n     monotonic setting turns off", () => {
    const { messages, calls } = conversation(10, BULKY);

    const hot = planPruning({
      messages,
      calls,
      pressure: { tokens: WINDOW * 0.9, contextWindow: WINDOW },
      config: CONFIG,
      state: freshState(),
    });
    expect(stubbedIdsOf(hot).length).toBeGreaterThan(0);

    const forgotten = planPruning({
      messages,
      calls,
      pressure: { tokens: WINDOW * 0.1, contextWindow: WINDOW },
      config: CONFIG,
      state: { decisions: new Map(), engaged: hot.engaged },
    });

    expect(stubbedIdsOf(forgotten)).toEqual([]);
  });
});

describe("renderStub", () => {
  test("always offers a way back", () => {
    const stub = renderStub("bash", 150, "stub", "a1b2c3");

    expect(stub).toContain("bash");
    expect(stub).toContain("150 lines");
    expect(stub).toContain('thrift_recall(ref="a1b2c3")');
  });

  test("explains why a superseded result went away", () => {
    expect(renderStub("read", 20, "superseded", "ref1")).toContain("superseded");
  });

  test("degrades honestly when no artifact was stored", () => {
    const stub = renderStub("read", 20, "stub", undefined);

    expect(stub).not.toContain("thrift_recall");
    expect(stub).toContain("Re-run the call");
  });
});
