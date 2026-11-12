import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_PACKET_OUTPUT_CHARS,
  resolvePacketOutput,
} from "../src/orchestration/packet-output.js";

const KEYS = ["test_output", "test_output_file"] as const;

let root: string;
let runs: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "accord-packet-output-"));
  runs = join(root, "runs");
  mkdirSync(runs);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function resolve(packet: Record<string, unknown>): string {
  return resolvePacketOutput(packet, ...KEYS, runs);
}

describe("resolvePacketOutput", () => {
  test("prefers a confined file over the inline excerpt and deletes it after reading", () => {
    const file = join(runs, "phase-test-output.txt");
    writeFileSync(file, "full output\n");
    expect(resolve({ test_output: "excerpt", test_output_file: file })).toBe("full output\n");
    expect(existsSync(file)).toBe(false);
  });

  test("resolves a relative path against the allowed folder and trims whitespace", () => {
    writeFileSync(join(runs, "rel.txt"), "relative");
    expect(resolve({ test_output_file: "  rel.txt " })).toBe("relative");
  });

  test.each([
    ["missing file", () => join(runs, "nope.txt")],
    ["blank path", () => "   "],
    ["directory", () => runs],
    [
      "empty file",
      () => {
        writeFileSync(join(runs, "empty.txt"), "  \n");
        return join(runs, "empty.txt");
      },
    ],
  ])("falls back to inline for %s", (_label, makePath) => {
    expect(resolve({ test_output: "inline", test_output_file: makePath() })).toBe("inline");
  });

  test.each([
    [
      "absolute path outside the folder",
      () => {
        writeFileSync(join(root, "secret.txt"), "SECRET");
        return join(root, "secret.txt");
      },
    ],
    [
      "parent traversal",
      () => {
        writeFileSync(join(root, "secret.txt"), "SECRET");
        return join(runs, "..", "secret.txt");
      },
    ],
    [
      "relative traversal",
      () => {
        writeFileSync(join(root, "secret.txt"), "SECRET");
        return "../secret.txt";
      },
    ],
    [
      "in-folder symlink pointing outside",
      () => {
        writeFileSync(join(root, "secret.txt"), "SECRET");
        symlinkSync(join(root, "secret.txt"), join(runs, "link.txt"));
        return join(runs, "link.txt");
      },
    ],
    ["/etc/passwd", () => "/etc/passwd"],
    ["/proc/self/environ", () => "/proc/self/environ"],
    ["/dev/zero", () => "/dev/zero"],
  ])("rejects %s and uses inline", (_label, makePath) => {
    expect(resolve({ test_output: "inline", test_output_file: makePath() })).toBe("inline");
  });

  test("rejected outside file is not deleted", () => {
    const secret = join(root, "secret.txt");
    writeFileSync(secret, "SECRET");
    resolve({ test_output_file: secret });
    expect(existsSync(secret)).toBe(true);
  });

  test("non-string inline values give an empty string", () => {
    expect(resolve({ test_output: 42 })).toBe("");
    expect(resolve({})).toBe("");
  });

  test("keeps only the tail of an oversized file", () => {
    const file = join(runs, "big.txt");
    writeFileSync(file, `${"x".repeat(MAX_PACKET_OUTPUT_CHARS * 5)}END`);
    const result = resolve({ test_output_file: file });
    expect(result.length).toBe(MAX_PACKET_OUTPUT_CHARS);
    expect(result.endsWith("END")).toBe(true);
  });

  test("keeps only the tail of an oversized inline fallback", () => {
    const result = resolve({ test_output: `${"y".repeat(MAX_PACKET_OUTPUT_CHARS)}END` });
    expect(result.length).toBe(MAX_PACKET_OUTPUT_CHARS);
    expect(result.endsWith("END")).toBe(true);
  });
});
