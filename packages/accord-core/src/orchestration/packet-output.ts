/**
 * Resolve raw test/verify output from a return packet.
 *
 * Agents write the full runner output to a file and return its path
 * (`test_output_file` / `verify_output_file`) plus a short inline excerpt.
 * Copying 64 KiB of output into the JSON packet costs up to ~16k output
 * tokens per run, so the harness reads the file itself. The inline field is
 * the fallback when no file is given or the file cannot be read.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createLogger } from "../logging.js";

const log = createLogger("orchestration:packet-output");

/** Max characters kept from a runner output (the tail is kept). */
export const MAX_PACKET_OUTPUT_CHARS = 65536;

function tail(text: string): string {
  return text.length > MAX_PACKET_OUTPUT_CHARS ? text.slice(-MAX_PACKET_OUTPUT_CHARS) : text;
}

/**
 * Full output for `inlineKey` (e.g. `test_output`): the file named by `fileKey`
 * when present and readable, otherwise the inline string. Relative paths
 * resolve against `cwd` (default: process cwd).
 */
export function resolvePacketOutput(
  packet: Record<string, unknown>,
  inlineKey: string,
  fileKey: string,
  cwd: string = process.cwd(),
): string {
  const inline = typeof packet[inlineKey] === "string" ? (packet[inlineKey] as string) : "";
  const filePath = packet[fileKey];
  if (typeof filePath !== "string" || filePath.trim() === "") return tail(inline);
  const absolute = path.resolve(cwd, filePath.trim());
  try {
    const content = fs.readFileSync(absolute, "utf8");
    if (content.trim() !== "") return tail(content);
    log.warn(`${fileKey} is empty: ${absolute} — using inline ${inlineKey}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.warn(`${fileKey} unreadable: ${absolute}: ${message} — using inline ${inlineKey}`);
  }
  return tail(inline);
}
