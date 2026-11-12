import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  MAX_PACKET_OUTPUT_CHARS,
  resolvePacketOutput,
} from "../src/orchestration/packet-output.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "accord-packet-output-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("resolvePacketOutput", () => {
  test("prefers the file over the inline excerpt", () => {
    const file = join(dir, "out.txt");
    writeFileSync(file, "full output\n");
    const packet = { test_output: "excerpt", test_output_file: file };
    expect(resolvePacketOutput(packet, "test_output", "test_output_file")).toBe("full output\n");
  });

  test("resolves a relative path against cwd", () => {
    writeFileSync(join(dir, "rel.txt"), "relative");
    const packet = { verify_output_file: "rel.txt" };
    expect(resolvePacketOutput(packet, "verify_output", "verify_output_file", dir)).toBe(
      "relative",
    );
  });

  test("falls back to inline when the file is missing or empty", () => {
    writeFileSync(join(dir, "empty.txt"), "  \n");
    expect(
      resolvePacketOutput(
        { test_output: "inline", test_output_file: join(dir, "nope.txt") },
        "test_output",
        "test_output_file",
      ),
    ).toBe("inline");
    expect(
      resolvePacketOutput(
        { test_output: "inline", test_output_file: join(dir, "empty.txt") },
        "test_output",
        "test_output_file",
      ),
    ).toBe("inline");
    expect(resolvePacketOutput({}, "test_output", "test_output_file")).toBe("");
  });

  test("keeps only the tail of oversized output", () => {
    const file = join(dir, "big.txt");
    writeFileSync(file, `${"x".repeat(MAX_PACKET_OUTPUT_CHARS)}END`);
    const result = resolvePacketOutput(
      { test_output_file: file },
      "test_output",
      "test_output_file",
    );
    expect(result.length).toBe(MAX_PACKET_OUTPUT_CHARS);
    expect(result.endsWith("END")).toBe(true);
  });
});
