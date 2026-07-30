import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ArtifactStore,
  type ArtifactStoreOptions,
  findArtifactRef,
  stripArtifactNotice,
} from "../packages/pi-thrift/src/artifacts.js";

const stores: ArtifactStore[] = [];

async function newStore(options?: ArtifactStoreOptions): Promise<ArtifactStore> {
  const dir = await mkdtemp(join(tmpdir(), "thrift-test-"));
  const store = new ArtifactStore(dir, options);
  stores.push(store);
  return store;
}

afterEach(async () => {
  await Promise.all(stores.splice(0).map((s) => s.dispose()));
});

describe("ArtifactStore", () => {
  test("round-trips stored content", async () => {
    const store = await newStore();
    const content = ["alpha", "beta", "gamma"].join("\n");

    const artifact = await store.put("read", "read a.ts", content);
    expect(await store.recall(artifact.ref)).toBe(content);
  });

  test("records size and line count", async () => {
    const store = await newStore();
    const artifact = await store.put("bash", "bash ls", "one\ntwo\nthree");

    expect(artifact.lines).toBe(3);
    expect(artifact.bytes).toBe(13);
    expect(artifact.toolName).toBe("bash");
  });

  test("content-addresses, so identical output costs one artifact", async () => {
    const store = await newStore();
    const a = await store.put("read", "read a.ts", "same content");
    const b = await store.put("read", "read b.ts", "same content");

    expect(a.ref).toBe(b.ref);
    expect(store.size).toBe(1);
  });

  test("gives different refs to different content", async () => {
    const store = await newStore();
    const a = await store.put("read", "a", "one");
    const b = await store.put("read", "b", "two");

    expect(a.ref).not.toBe(b.ref);
    expect(store.size).toBe(2);
  });

  test("windows long content and points at the next page", async () => {
    const store = await newStore();
    const content = Array.from({ length: 1_000 }, (_, i) => `line${i}`).join("\n");
    const artifact = await store.put("read", "read big.ts", content);

    const page = await store.recall(artifact.ref, 1, 10);
    expect(page).toContain("line0");
    expect(page).toContain("line9");
    expect(page).not.toContain("line10\n");
    expect(page).toContain("Use offset=11 to continue.");
  });

  test("honours an offset", async () => {
    const store = await newStore();
    const content = Array.from({ length: 100 }, (_, i) => `line${i}`).join("\n");
    const artifact = await store.put("read", "read big.ts", content);

    const page = await store.recall(artifact.ref, 50, 5);
    expect(page).toContain("line49");
    expect(page).not.toContain("line0\n");
  });

  test("caps a single recall so recovery cannot reopen the context window", async () => {
    const store = await newStore();
    const content = Array.from({ length: 5_000 }, (_, i) => `line${i}`).join("\n");
    const artifact = await store.put("read", "read huge.ts", content);

    const page = await store.recall(artifact.ref, 1, 99_999);
    expect(page.split("\n").length).toBeLessThan(500);
  });

  test("reports total bytes held", async () => {
    const store = await newStore();
    await store.put("read", "a", "12345");
    await store.put("read", "b", "678");

    expect(store.totalBytes).toBe(8);
  });

  test("rejects an unknown ref with a usable message", async () => {
    const store = await newStore();
    await store.put("read", "a", "content");

    await expect(store.recall("nope")).rejects.toThrow(/Unknown artifact ref/);
  });

  test("rejects an offset past the end", async () => {
    const store = await newStore();
    const artifact = await store.put("read", "a", "one\ntwo");

    await expect(store.recall(artifact.ref, 99)).rejects.toThrow(/beyond the end/);
  });

  test("dispose clears the index", async () => {
    const store = await newStore();
    await store.put("read", "a", "content");
    await store.dispose();

    expect(store.size).toBe(0);
  });

  test("explains a spill file that vanished underneath it", async () => {
    const store = await newStore();
    const artifact = await store.put("read", "read a.ts", "content");
    await rm(artifact.path);

    await expect(store.recall(artifact.ref)).rejects.toThrow(/no longer readable/);
  });
});

describe("spill", () => {
  test("returns the artifact on success, like put", async () => {
    const store = await newStore();
    const artifact = await store.spill("read", "read a.ts", "content");

    expect(artifact?.ref).toBeDefined();
    expect(store.failures).toBe(0);
  });

  test("reports failure instead of throwing, so a caller can keep the content", async () => {
    // A path that cannot be a directory: every write into it fails.
    const store = new ArtifactStore(join(tmpdir(), "thrift-test-unwritable", "\u0000bad"));

    const artifact = await store.spill("read", "read a.ts", "content");

    expect(artifact).toBeUndefined();
    expect(store.failures).toBe(1);
    expect(store.lastError).not.toBeNull();
  });
});

describe("size ceiling", () => {
  test("evicts the oldest artifacts to stay under the cap", async () => {
    const store = await newStore({ maxBytes: 100 });
    const first = await store.put("read", "first", "a".repeat(80));
    const second = await store.put("read", "second", "b".repeat(80));

    expect(store.get(second.ref)).toBeDefined();
    expect(store.get(first.ref)).toBeUndefined();
    expect(store.totalBytes).toBeLessThanOrEqual(100);
  });

  test("keeps the artifact it was just asked to store", async () => {
    const store = await newStore({ maxBytes: 10 });
    const big = await store.put("read", "big", "x".repeat(500));

    expect(store.get(big.ref)).toBeDefined();
  });

  test("says an evicted ref was evicted, not that it never existed", async () => {
    const store = await newStore({ maxBytes: 100 });
    const first = await store.put("read", "first", "a".repeat(80));
    await store.put("read", "second", "b".repeat(80));

    await expect(store.recall(first.ref)).rejects.toThrow(/was evicted/);
  });
});

describe("refs in text", () => {
  test("recovers the ref thrift wrote into a notice", async () => {
    const store = await newStore();
    const artifact = await store.put("read", "read a.ts", "content");
    const annotated = `body\n\n[thrift: reduced. Full output: thrift_recall(ref="${artifact.ref}").]`;

    expect(findArtifactRef(annotated)).toBe(artifact.ref);
  });

  test("finds nothing in unannotated text", () => {
    expect(findArtifactRef("just some output")).toBeUndefined();
  });

  test("strips a notice so re-annotating cannot stack them", () => {
    const annotated = 'body\n\n[thrift: reduced. Full output: thrift_recall(ref="abc123").]';

    expect(stripArtifactNotice(annotated)).toBe("body");
  });
});
