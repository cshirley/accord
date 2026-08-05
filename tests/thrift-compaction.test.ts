import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore, findArtifactRef } from "../packages/pi-thrift/src/artifacts.js";
import {
  reduceMessagesInPlace,
  shouldSkipTurnPrefixCompactionPrep,
} from "../packages/pi-thrift/src/compaction.js";
import { DEFAULT_CONFIG, type ThriftConfig } from "../packages/pi-thrift/src/config.js";

const stores: ArtifactStore[] = [];

async function newStore(): Promise<ArtifactStore> {
  const dir = await mkdtemp(join(tmpdir(), "thrift-compact-"));
  const store = new ArtifactStore(dir);
  stores.push(store);
  return store;
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map((s) => s.dispose()));
});

function config(): ThriftConfig {
  return structuredClone(DEFAULT_CONFIG);
}

/** A listing past the 2KB floor and the 200-entry cap, so the reducers have
 *  something to bite on, but under the 400-line recall cap so a test can
 *  compare a whole artifact against the original in one call. */
function bigListing(): string {
  return Array.from({ length: 300 }, (_, i) => `src/generated/module${i}.ts`).join("\n");
}

function toolResult(toolName: string, text: string) {
  return { role: "toolResult", toolName, content: [{ type: "text", text }] };
}

function textOf(message: ReturnType<typeof toolResult> | undefined): string {
  return message?.content[0]?.text ?? "";
}

describe("reduceMessagesInPlace", () => {
  test("reduces an oversized result", async () => {
    const store = await newStore();
    const messages = [toolResult("grep", bigListing())];

    const count = await reduceMessagesInPlace(messages, config(), store);

    expect(count).toBe(1);
    expect(textOf(messages[0]).length).toBeLessThan(bigListing().length);
  });

  test("leaves a recall ref behind, because prefix messages outlive the compaction", async () => {
    const store = await newStore();
    const original = bigListing();
    const messages = [toolResult("grep", original)];

    await reduceMessagesInPlace(messages, config(), store);

    const ref = findArtifactRef(textOf(messages[0]));
    expect(ref).toBeDefined();
    expect(await store.recall(ref as string, 1, 5_000)).toBe(original);
  });

  test("points at the source artifact rather than storing the reduced copy again", async () => {
    const store = await newStore();
    const original = bigListing();
    const artifact = await store.put("grep", "grep generated", original);

    const alreadyReduced =
      `${Array.from({ length: 250 }, (_, i) => `src/generated/module${i}.ts`).join("\n")}\n\n` +
      `[thrift: reduced to 7KB of 9KB (300 lines). Full output: thrift_recall(ref="${artifact.ref}").]`;
    const messages = [toolResult("grep", alreadyReduced)];

    await reduceMessagesInPlace(messages, config(), store);

    expect(findArtifactRef(textOf(messages[0]))).toBe(artifact.ref);
    expect(store.size).toBe(1);
  });

  test("annotates once, however many passes run over the same block", async () => {
    const store = await newStore();
    const messages = [toolResult("grep", bigListing())];

    await reduceMessagesInPlace(messages, config(), store);
    await reduceMessagesInPlace(messages, config(), store);

    expect(textOf(messages[0]).match(/thrift_recall/g)?.length).toBe(1);
  });

  test("leaves the content alone when it cannot be spilled", async () => {
    const unwritable = new ArtifactStore(join(tmpdir(), "thrift-compact-unwritable", "\u0000bad"));
    const original = bigListing();
    const messages = [toolResult("grep", original)];

    const count = await reduceMessagesInPlace(messages, config(), unwritable);

    expect(count).toBe(0);
    expect(textOf(messages[0])).toBe(original);
  });

  test("ignores results below pi's own serialisation cut", async () => {
    const store = await newStore();
    const small = "one\ntwo\nthree";
    const messages = [toolResult("grep", small)];

    const count = await reduceMessagesInPlace(messages, config(), store);

    expect(count).toBe(0);
    expect(textOf(messages[0])).toBe(small);
    expect(store.size).toBe(0);
  });

  test("ignores anything that is not a tool result", async () => {
    const store = await newStore();
    const messages = [{ role: "assistant", content: [{ type: "text", text: bigListing() }] }];

    expect(await reduceMessagesInPlace(messages, config(), store)).toBe(0);
  });

  test("tolerates a preparation field that is not an array", async () => {
    const store = await newStore();

    expect(await reduceMessagesInPlace(undefined, config(), store)).toBe(0);
    expect(await reduceMessagesInPlace(null, config(), store)).toBe(0);
    expect(await reduceMessagesInPlace("nonsense", config(), store)).toBe(0);
  });
});

describe("shouldSkipTurnPrefixCompactionPrep", () => {
  test("overflow + willRetry skips turn-prefix pre-processing", () => {
    expect(shouldSkipTurnPrefixCompactionPrep("overflow", true)).toBe(true);
  });

  test("overflow without retry still reduces turn prefix", () => {
    expect(shouldSkipTurnPrefixCompactionPrep("overflow", false)).toBe(false);
  });

  test("manual and threshold never skip turn prefix", () => {
    expect(shouldSkipTurnPrefixCompactionPrep("manual", true)).toBe(false);
    expect(shouldSkipTurnPrefixCompactionPrep("threshold", true)).toBe(false);
  });
});
