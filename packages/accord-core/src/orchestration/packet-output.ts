/**
 * Resolve raw test/verify output from a return packet.
 *
 * The harness gives `phase-test` / `phase-verify-task` an `output_file` inside the task's
 * harness-owned runs folder (`.tasks/<ID>-task-<N>/runs/`). The agent writes the full runner
 * output there and returns the path (`test_output_file` / `verify_output_file`) plus a short
 * inline excerpt, so the packet does not carry up to 64 KiB of output (~16k output tokens).
 *
 * The path comes from a model-controlled packet, so the read is confined: the real path must be
 * a direct child of `allowedDir` (itself not a symlink), not a symlink, FIFO or hardlink, a
 * regular file owned by this process's user, and only the tail is read. Anything else falls back to the
 * inline field. The file is deleted after a successful read so a later round cannot reuse it.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { createLogger } from "../logging.js";

const log = createLogger("orchestration:packet-output");

/** Max characters kept from a runner output (the tail is kept). */
export const MAX_PACKET_OUTPUT_CHARS = 65536;

/** Max bytes read from disk: enough for MAX chars of multi-byte UTF-8. */
const MAX_PACKET_OUTPUT_BYTES = MAX_PACKET_OUTPUT_CHARS * 4;

function tail(text: string): string {
  return text.length > MAX_PACKET_OUTPUT_CHARS ? text.slice(-MAX_PACKET_OUTPUT_CHARS) : text;
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

/** Tail of a confined regular file, or `null` when any check fails. */
function readConfinedTail(filePath: string, allowedDir: string): string | null {
  let fd: number | undefined;
  try {
    // The runs folder itself must be a real directory, not a symlink planted to widen the root.
    if (!fs.lstatSync(allowedDir).isDirectory()) return null;
    const root = fs.realpathSync(allowedDir);
    const candidate = path.isAbsolute(filePath) ? filePath : path.resolve(root, filePath);
    const real = fs.realpathSync(candidate);
    // Direct children only: no sub-folders that could be swapped for a symlink after realpath.
    if (!isInside(root, real) || path.dirname(real) !== root) return null;
    // Fail fast on FIFOs/devices before open; O_NONBLOCK stops a FIFO open from blocking anyway.
    if (!fs.lstatSync(real).isFile()) return null;
    fd = fs.openSync(
      real,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0),
    );
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) return null;
    // A harness-created output file has one link; a hardlink to another file has more.
    if (stat.nlink !== 1) return null;
    const uid = process.getuid?.();
    if (uid !== undefined && stat.uid !== uid) return null;
    const length = Math.min(stat.size, MAX_PACKET_OUTPUT_BYTES);
    const buffer = Buffer.alloc(length);
    let bytesRead = 0;
    while (bytesRead < length) {
      const read = fs.readSync(
        fd,
        buffer,
        bytesRead,
        length - bytesRead,
        stat.size - length + bytesRead,
      );
      if (read === 0) break;
      bytesRead += read;
    }
    const content = buffer.toString("utf8", 0, bytesRead);
    try {
      fs.unlinkSync(real);
    } catch {
      /* best effort: a leftover file is rejected next round only if stale content is reused */
    }
    return content;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/**
 * Full output for `inlineKey` (e.g. `test_output`): the file named by `fileKey` when it passes
 * the confinement checks against `allowedDir`, otherwise the inline string. Relative paths
 * resolve against `allowedDir`.
 */
export function resolvePacketOutput(
  packet: Record<string, unknown>,
  inlineKey: string,
  fileKey: string,
  allowedDir: string,
): string {
  const inline = typeof packet[inlineKey] === "string" ? (packet[inlineKey] as string) : "";
  const filePath = packet[fileKey];
  if (typeof filePath !== "string" || filePath.trim() === "") return tail(inline);
  const content = readConfinedTail(filePath.trim(), allowedDir);
  if (content === null) {
    // Do not log the path or error: it may name a file the agent should not have pointed at.
    log.warn(`${fileKey} rejected or unreadable — using inline ${inlineKey}`);
    return tail(inline);
  }
  if (content.trim() === "") {
    log.warn(`${fileKey} is empty — using inline ${inlineKey}`);
    return tail(inline);
  }
  return tail(content);
}
