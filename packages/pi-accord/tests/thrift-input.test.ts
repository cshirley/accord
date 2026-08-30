/**
 * Wiring tests for the two pruning stages.
 *
 * The planner and the store are covered on their own elsewhere. What only
 * shows up here is the contract between them: that nothing leaves the
 * conversation without an artifact behind it, and that the ref the model is
 * handed resolves to the output it actually lost.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ArtifactStore, findArtifactRef } from "../../pi-thrift/src/artifacts.js";
import { DEFAULT_CONFIG, type ThriftConfig } from "../../pi-thrift/src/config.js";
import { type InputStats, registerInputPruning } from "../../pi-thrift/src/input.js";

// ── Fakes ───────────────────────────────────────────────────────────────

interface TextBlock {
  type: string;
  text?: string;
}

interface Message {
  role: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  content?: unknown;
}

type Handler = (event: unknown, ctx: unknown) => unknown;

interface Harness {
  config: ThriftConfig;
  store: ArtifactStore;
  stats: InputStats;
  emit: (event: string, payload: unknown, ctx: unknown) => Promise<unknown>;
}

const stores: ArtifactStore[] = [];

afterEach(async () => {
  await Promise.all(stores.splice(0).map((s) => s.dispose()));
});

async function harness(store?: ArtifactStore): Promise<Harness> {
  const resolved = store ?? new ArtifactStore(await mkdtemp(join(tmpdir(), "thrift-input-")));
  stores.push(resolved);

  const handlers = new Map<string, Handler[]>();
  const pi = {
    on(event: string, handler: Handler) {
      const existing = handlers.get(event) ?? [];
      existing.push(handler);
      handlers.set(event, existing);
    },
    registerTool() {},
  };

  const config = structuredClone(DEFAULT_CONFIG);
  const stats = registerInputPruning(pi as unknown as ExtensionAPI, config, resolved);

  return {
    config,
    store: resolved,
    stats,
    async emit(event, payload, ctx) {
      let last: unknown;
      for (const handler of handlers.get(event) ?? []) {
        const result = await handler(payload, ctx);
        if (result !== undefined) last = result;
      }
      return last;
    },
  };
}

/** A context with a host that reports usage at the given fill. */
function ctxAt(fill: number): unknown {
  return {
    ui: { setStatus: () => {} },
    getContextUsage: () => ({
      tokens: 200_000 * fill,
      contextWindow: 200_000,
      percent: fill * 100,
    }),
  };
}

/** A context from a host with no usage API at all. */
function ctxBlind(): unknown {
  return { ui: { setStatus: () => {} } };
}

// ── Fixtures ────────────────────────────────────────────────────────────

/** Prose past the 48KB read threshold but under the 400-line recall cap, so a
 *  single recall returns the whole artifact and tests can compare it. */
function bigProse(seed: string): string {
  return Array.from({ length: 300 }, (_, i) => `${seed} paragraph ${i} ${"detail ".repeat(24)}`)
    .join("\n")
    .concat("\n");
}

function readResult(callId: string, path: string, text: string): unknown {
  return {
    toolCallId: callId,
    toolName: "read",
    input: { path },
    content: [{ type: "text", text }],
    isError: false,
  };
}

/** Ten turns of read results, each a distinct file so nothing is superseded
 *  and the only reason to elide is pressure. */
function conversation(bodies: Map<string, string>): Message[] {
  const messages: Message[] = [];
  let t = 0;
  for (const [callId, text] of bodies) {
    messages.push({ role: "user", content: [{ type: "text", text: "go" }] });
    messages.push({
      role: "assistant",
      content: [
        { type: "toolCall", id: callId, name: "read", arguments: { path: `src/file${t}.ts` } },
      ],
    });
    messages.push({
      role: "toolResult",
      toolCallId: callId,
      toolName: "read",
      isError: false,
      content: [{ type: "text", text }],
    });
    t++;
  }
  return messages;
}

function bodiesFor(turns: number, bytes: number): Map<string, string> {
  const out = new Map<string, string>();
  for (let t = 0; t < turns; t++) {
    out.set(`call-${t}`, `body ${t} `.padEnd(bytes, "x"));
  }
  return out;
}

function messageText(messages: Message[], callId: string): string {
  const found = messages.find((m) => m.toolCallId === callId);
  const block = (found?.content as TextBlock[] | undefined)?.find((c) => c.type === "text");
  return block?.text ?? "";
}

function stubbedMessages(messages: Message[]): Message[] {
  return messages.filter((m) => messageText([m], m.toolCallId ?? "").startsWith("[thrift:"));
}

// ── Stage 1: reduction at source ────────────────────────────────────────

describe("reduction at source", () => {
  test("reduces an oversized read and names the artifact holding the rest", async () => {
    const h = await harness();
    const original = bigProse("alpha");

    const result = (await h.emit(
      "tool_result",
      readResult("call-0", "notes.md", original),
      ctxAt(0.1),
    )) as { content: TextBlock[] } | undefined;

    const text = result?.content[0]?.text ?? "";
    expect(text.length).toBeLessThan(original.length);

    const ref = findArtifactRef(text);
    expect(ref).toBeDefined();
    expect(await h.store.recall(ref as string, 1, 5_000)).toBe(original);
  });

  test("leaves the result whole when the spill fails", async () => {
    const unwritable = new ArtifactStore(join(tmpdir(), "thrift-input-unwritable", "\u0000bad"));
    const h = await harness(unwritable);

    const result = await h.emit(
      "tool_result",
      readResult("call-0", "notes.md", bigProse("alpha")),
      ctxAt(0.1),
    );

    expect(result).toBeUndefined();
    expect(unwritable.failures).toBe(1);
  });

  test("stores nothing when reduction would not save anything", async () => {
    const h = await harness();
    // Under the threshold, so stage 1 declines and no artifact is written.
    await h.emit("tool_result", readResult("call-0", "notes.md", "short"), ctxAt(0.1));

    expect(h.store.size).toBe(0);
  });
});

// ── Stage 2: elision before the call ────────────────────────────────────

describe("elision before the call", () => {
  test("every stub it produces carries a ref that resolves", async () => {
    const h = await harness();
    const bodies = bodiesFor(10, 30_000);
    const messages = conversation(bodies);

    const result = (await h.emit("context", { messages }, ctxAt(0.8))) as
      | { messages: Message[] }
      | undefined;
    const pruned = result?.messages ?? [];

    const stubs = stubbedMessages(pruned);
    expect(stubs.length).toBeGreaterThan(0);

    for (const stub of stubs) {
      const text = messageText(pruned, stub.toolCallId ?? "");
      const ref = findArtifactRef(text);
      expect(ref).toBeDefined();

      const original = bodies.get(stub.toolCallId ?? "") ?? "";
      expect(await h.store.recall(ref as string, 1, 5_000)).toBe(original);
    }
  });

  test("a result already reduced at source recalls the original, not the reduction", async () => {
    const h = await harness();
    const original = bigProse("alpha");

    const reducedResult = (await h.emit(
      "tool_result",
      readResult("call-0", "notes.md", original),
      ctxAt(0.1),
    )) as { content: TextBlock[] };
    const reduced = reducedResult.content[0]?.text ?? "";

    const bodies = bodiesFor(10, 30_000);
    bodies.set("call-0", reduced);
    const ordered = new Map([["call-0", reduced], ...bodies]);

    const result = (await h.emit("context", { messages: conversation(ordered) }, ctxAt(0.8))) as {
      messages: Message[];
    };

    const stub = messageText(result.messages, "call-0");
    expect(stub).toStartWith("[thrift:");

    const ref = findArtifactRef(stub);
    expect(await h.store.recall(ref as string, 1, 5_000)).toBe(original);
  });

  test("keeps a result whole rather than pointing at an artifact it could not write", async () => {
    const unwritable = new ArtifactStore(join(tmpdir(), "thrift-input-unwritable", "\u0000bad"));
    const h = await harness(unwritable);
    const bodies = bodiesFor(10, 30_000);

    const result = (await h.emit("context", { messages: conversation(bodies) }, ctxAt(0.8))) as
      | { messages: Message[] }
      | undefined;

    expect(result).toBeUndefined();
    expect(h.stats.lastContextHeldBack).toBeGreaterThan(0);
    expect(h.stats.lastContextStubbed).toBe(0);
  });

  test("elides nothing while context is quiet", async () => {
    const h = await harness();
    const result = await h.emit(
      "context",
      { messages: conversation(bodiesFor(10, 30_000)) },
      ctxAt(0.2),
    );

    expect(result).toBeUndefined();
    expect(h.stats.lastContextStubbed).toBe(0);
  });

  test("accepts string content on user messages", async () => {
    const h = await harness();
    const bodies = bodiesFor(10, 30_000);
    const messages = conversation(bodies);
    messages[0] = { role: "user", content: "go" };

    const result = (await h.emit("context", { messages }, ctxAt(0.8))) as
      | { messages: Message[] }
      | undefined;

    expect(result?.messages).toBeDefined();
    expect(stubbedMessages(result?.messages ?? []).length).toBeGreaterThan(0);
  });

  test("estimates pressure when the host reports none, instead of eliding blindly", async () => {
    const h = await harness();
    await h.emit("context", { messages: conversation(bodiesFor(4, 30_000)) }, ctxBlind());

    expect(h.stats.lastEstimated).toBe(true);
    expect(h.stats.lastContextStubbed).toBe(0);
  });
});

// ── Monotonicity ────────────────────────────────────────────────────────

describe("monotonic decisions", () => {
  test("a result elided once stays elided when pressure drops", async () => {
    const h = await harness();
    const messages = conversation(bodiesFor(10, 30_000));

    const hot = (await h.emit("context", { messages }, ctxAt(0.8))) as { messages: Message[] };
    const elided = stubbedMessages(hot.messages).map((m) => m.toolCallId);
    expect(elided.length).toBeGreaterThan(0);

    const cool = (await h.emit("context", { messages }, ctxAt(0.1))) as { messages: Message[] };

    for (const id of elided) {
      expect(messageText(cool.messages, id ?? "")).toStartWith("[thrift:");
    }
  });

  test("turning monotonic off lets a result come back once pressure passes", async () => {
    const h = await harness();
    h.config.input.monotonic = false;
    const messages = conversation(bodiesFor(10, 30_000));

    const hot = (await h.emit("context", { messages }, ctxAt(0.8))) as { messages: Message[] };
    expect(stubbedMessages(hot.messages).length).toBeGreaterThan(0);

    const cool = await h.emit("context", { messages }, ctxAt(0.1));

    expect(cool).toBeUndefined();
  });
});
