import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Artifact,
  ArtifactStore,
  type ArtifactStoreOptions,
  findArtifactRef,
  formatInventory,
  stripArtifactNotice,
} from "../../pi-thrift/src/artifacts.js";

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

describe("formatInventory", () => {
  function artifact(overrides: Partial<Artifact> = {}): Artifact {
    return {
      ref: "a".repeat(16),
      toolName: "read",
      label: "read src/input.ts",
      path: "/tmp/x.txt",
      bytes: 2048,
      lines: 90,
      createdAt: 0,
      ...overrides,
    };
  }

  test("says plainly when there is nothing to recall", () => {
    expect(formatInventory([])).toMatch(/No artifacts held/);
  });

  test("lists the ref, size, line count and origin of each artifact", () => {
    const text = formatInventory([artifact()]);

    expect(text).toContain("a".repeat(16));
    expect(text).toContain("90 lines");
    expect(text).toContain("read src/input.ts");
  });

  test("counts one artifact in the singular", () => {
    expect(formatInventory([artifact()])).toContain("1 recoverable artifact,");
  });

  test("caps the listing and reports the exact remainder", () => {
    const many = Array.from({ length: 45 }, (_, i) =>
      artifact({ ref: String(i).padStart(16, "0"), label: `read file-${i}.ts` }),
    );

    const text = formatInventory(many);

    expect(text).toContain("45 recoverable artifacts");
    expect(text).toContain("read file-39.ts");
    expect(text).not.toContain("read file-40.ts");
    expect(text).toContain("[5 older artifacts not shown.]");
  });

  test("omits the remainder footer when everything fits", () => {
    expect(formatInventory([artifact()])).not.toContain("not shown");
  });

  // The inventory exists because a ref outlives the text that carried it, so the
  // store's own ordering is what makes the cap tolerable.
  test("preserves the newest-first order it is given", () => {
    const text = formatInventory([
      artifact({ ref: "b".repeat(16), label: "read newer.ts" }),
      artifact({ ref: "c".repeat(16), label: "read older.ts" }),
    ]);

    expect(text.indexOf("read newer.ts")).toBeLessThan(text.indexOf("read older.ts"));
  });
});

describe("recall without a ref", () => {
  test("points a bad ref at the inventory rather than dumping bare refs", async () => {
    const store = await newStore();
    await store.put("read", "read a.ts", "content");

    await expect(store.recall("nope")).rejects.toThrow(/with no ref to list what is available/);
  });

  test("lists what the store holds, newest first", async () => {
    const store = await newStore();
    await store.put("read", "read older.ts", "one\ntwo");
    await store.put("bash", "bash npm test", "three\nfour");

    const text = formatInventory(store.list());

    expect(text).toContain("2 recoverable artifacts");
    expect(text.indexOf("bash npm test")).toBeLessThan(text.indexOf("read older.ts"));
  });

  // A stage-2 pass spills everything it elides inside one loop, so `Date.now()`
  // is identical across the batch. Sorting on it left the batch oldest-first,
  // which is precisely the half the inventory cap discards.
  test("orders a same-millisecond batch newest-first", async () => {
    const store = await newStore();
    for (let i = 0; i < 5; i++) await store.put("read", `read file-${i}.ts`, `body ${i}`);

    const labels = store.list().map((a) => a.label);

    expect(labels).toEqual([
      "read file-4.ts",
      "read file-3.ts",
      "read file-2.ts",
      "read file-1.ts",
      "read file-0.ts",
    ]);
  });

  test("keeps a re-spill of identical content at its original position", async () => {
    const store = await newStore();
    await store.put("read", "read first.ts", "same body");
    await store.put("read", "read second.ts", "other body");
    await store.put("read", "read first.ts", "same body");

    expect(store.list().map((a) => a.label)).toEqual(["read second.ts", "read first.ts"]);
  });
});
