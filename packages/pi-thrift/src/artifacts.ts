/**
 * Artifact store — recoverable elision.
 *
 * Thrift's original design destroyed whatever it trimmed: an oversized tool
 * result was cut at source and the overflow was gone, and a stubbed result was
 * replaced by a one-line placeholder the model had no way to expand.  That is
 * lossy compression, and it is the reason aggressive pruning felt risky.
 *
 * Everything thrift removes now goes to a temp file first and the replacement
 * text carries a short ref.  The model calls `thrift_recall` to get any of it
 * back, windowed by line.  Compression becomes lossless-with-latency, which is
 * what makes it safe to prune harder than before.
 *
 * pi's own bash tool already works this way — it spills full output and puts
 * the path in the model-visible text.  This generalises that to every tool.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export interface Artifact {
  /** Short content-addressed handle quoted to the model. */
  ref: string;
  toolName: string;
  /** Human-readable origin, e.g. `read src/input.ts`. */
  label: string;
  path: string;
  bytes: number;
  lines: number;
  createdAt: number;
}

/** Cap on what a single recall may return, so recovering an artifact cannot
 *  itself blow the context window back open. */
const RECALL_MAX_LINES = 400;

/**
 * Ref length in hex characters.
 *
 * 16 characters is 64 bits. A collision would silently hand the model the
 * wrong file, which is a worse failure than any amount of context spent on a
 * longer ref, so this is deliberately far past what the birthday bound needs
 * for the few thousand artifacts a session actually produces.
 */
const REF_LENGTH = 16;

/**
 * Ceiling on what one session may hold on disk.
 *
 * Ordinary sessions land three orders of magnitude below this. It exists so a
 * pathological run cannot fill the volume thrift is spilling to — an extension
 * that saves tokens by exhausting the disk has made things worse.
 */
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;

export interface ArtifactStoreOptions {
  maxBytes?: number;
}

const REF_IN_TEXT = /thrift_recall\(ref="([0-9a-f]+)"\)/;
const NOTICE_IN_TEXT = /\n*\[thrift: [^\]]*thrift_recall\(ref="[0-9a-f]+"\)\.\]/g;

/**
 * Recover the ref from text thrift has already annotated.
 *
 * A second reduction pass over an already-reduced block must point at the
 * original output, not store its own abbreviated copy — otherwise recovery
 * becomes a chase through refs that each yield another ref.
 */
export function findArtifactRef(text: string): string | undefined {
  return REF_IN_TEXT.exec(text)?.[1];
}

/** Remove a previous recall notice, so re-annotating cannot stack them. */
export function stripArtifactNotice(text: string): string {
  return text.replace(NOTICE_IN_TEXT, "");
}

export class ArtifactStore {
  private readonly dir: string;
  private readonly maxBytes: number;
  private readonly byRef = new Map<string, Artifact>();
  /** Refs dropped to stay under `maxBytes`, so recall can say what happened
   *  rather than claiming the ref was never valid. */
  private readonly evictedRefs = new Set<string>();
  private dirReady: Promise<void> | null = null;
  private bytesHeld = 0;
  private failureCount = 0;
  private lastFailure: string | null = null;

  constructor(dir?: string, options: ArtifactStoreOptions = {}) {
    this.dir = dir ?? join(tmpdir(), `pi-thrift-${process.pid}`);
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  }

  get size(): number {
    return this.byRef.size;
  }

  /** Total bytes held on disk — reported by `/tp stats`. */
  get totalBytes(): number {
    return this.bytesHeld;
  }

  /** Spills that could not be written. Non-zero means thrift has been keeping
   *  content in context rather than risk eliding it unrecoverably. */
  get failures(): number {
    return this.failureCount;
  }

  get lastError(): string | null {
    return this.lastFailure;
  }

  private ensureDir(): Promise<void> {
    // 0o700: artifacts hold verbatim file contents and command output, and the
    // system temp directory is world-readable by default.
    this.dirReady ??= mkdir(this.dir, { recursive: true, mode: 0o700 }).then(() => undefined);
    return this.dirReady;
  }

  /**
   * Persist content and return its handle.
   *
   * Refs are content-addressed, so the same output stored twice costs one file
   * and one ref. That matters: re-reading an unchanged file is common, and it
   * lets the dedupe pass in policy.ts point several stubs at one artifact.
   */
  async put(toolName: string, label: string, content: string): Promise<Artifact> {
    const ref = createHash("sha256").update(content).digest("hex").slice(0, REF_LENGTH);

    const existing = this.byRef.get(ref);
    if (existing !== undefined) return existing;

    await this.ensureDir();
    const path = join(this.dir, `${ref}.txt`);
    await writeFile(path, content, { encoding: "utf8", mode: 0o600 });

    const artifact: Artifact = {
      ref,
      toolName,
      label,
      path,
      bytes: Buffer.byteLength(content, "utf-8"),
      lines: content === "" ? 0 : content.split("\n").length,
      createdAt: Date.now(),
    };
    this.byRef.set(ref, artifact);
    this.bytesHeld += artifact.bytes;
    this.evictedRefs.delete(ref);
    await this.evictToFit(ref);
    return artifact;
  }

  /**
   * Store content for later recall, reporting failure instead of throwing.
   *
   * Every caller spills so that it can then remove something from the
   * conversation, which makes a failed spill a decision point rather than an
   * error: the right response is to leave the content where it is. Throwing
   * from inside a context or tool-result hook would abandon the whole turn, so
   * a full disk would cost the user their request rather than some tokens.
   * Callers treat `undefined` as "do not elide this".
   */
  async spill(toolName: string, label: string, content: string): Promise<Artifact | undefined> {
    try {
      return await this.put(toolName, label, content);
    } catch (error) {
      this.failureCount++;
      this.lastFailure = error instanceof Error ? error.message : String(error);
      return undefined;
    }
  }

  /** Drop the oldest artifacts until the store fits its ceiling again. The
   *  artifact just written is exempt: evicting it would defeat the spill it
   *  was called for. */
  private async evictToFit(keepRef: string): Promise<void> {
    if (this.bytesHeld <= this.maxBytes) return;

    for (const [ref, artifact] of this.byRef) {
      if (this.bytesHeld <= this.maxBytes) break;
      if (ref === keepRef) continue;

      this.byRef.delete(ref);
      this.bytesHeld -= artifact.bytes;
      this.evictedRefs.add(ref);
      await rm(artifact.path, { force: true }).catch(() => undefined);
    }
  }

  get(ref: string): Artifact | undefined {
    return this.byRef.get(ref);
  }

  list(): Artifact[] {
    return [...this.byRef.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Read a line window out of a stored artifact. `offset` is 1-indexed to
   *  match the `read` tool, so the model does not have to switch conventions. */
  async recall(ref: string, offset = 1, limit = RECALL_MAX_LINES): Promise<string> {
    const artifact = this.byRef.get(ref);
    if (artifact === undefined) {
      if (this.evictedRefs.has(ref)) {
        throw new Error(
          `Artifact "${ref}" was evicted to keep the store under its size limit. ` +
            `Re-run the call that produced it.`,
        );
      }
      const known = this.list()
        .slice(0, 10)
        .map((a) => a.ref)
        .join(", ");
      throw new Error(
        `Unknown artifact ref "${ref}".${known === "" ? "" : ` Available refs: ${known}`}`,
      );
    }

    // The spill directory lives under the system temp dir, which some platforms
    // sweep while long sessions are still running. Say so, rather than leaking
    // a bare ENOENT the model has to guess at.
    let content: string;
    try {
      content = await readFile(artifact.path, "utf8");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Artifact "${ref}" (${artifact.label}) is no longer readable — its temp file is gone. ` +
          `Re-run the call that produced it. (${detail})`,
      );
    }

    const lines = content.split("\n");
    const start = Math.max(0, offset - 1);

    if (start >= lines.length) {
      throw new Error(
        `Offset ${offset} is beyond the end of artifact ${ref} (${lines.length} lines).`,
      );
    }

    const count = Math.min(limit, RECALL_MAX_LINES);
    const end = Math.min(start + count, lines.length);
    const window = lines.slice(start, end).join("\n");
    const remaining = lines.length - end;

    if (remaining <= 0) return window;
    return `${window}\n\n[${remaining} more lines. Use offset=${end + 1} to continue.]`;
  }

  async dispose(): Promise<void> {
    this.byRef.clear();
    this.evictedRefs.clear();
    this.bytesHeld = 0;
    if (this.dirReady === null) return;
    await rm(this.dir, { recursive: true, force: true }).catch(() => undefined);
    this.dirReady = null;
  }
}

/**
 * Register the recall tool.
 *
 * The description doubles as the contract the model reads, so it states the
 * line cap and the pagination convention explicitly. A recovery path the model
 * does not understand is no recovery path at all.
 */
export function registerRecallTool(pi: ExtensionAPI, store: ArtifactStore): void {
  pi.registerTool({
    name: "thrift_recall",
    label: "recall",
    description:
      "Retrieve tool output that thrift elided from the conversation. " +
      "Pass the ref quoted in a [thrift: ...] marker. " +
      `Returns at most ${RECALL_MAX_LINES} lines; use offset to page through more.`,
    parameters: Type.Object({
      ref: Type.String({ description: "Artifact ref from a [thrift: ...] marker" }),
      offset: Type.Optional(
        Type.Number({ description: "Line to start from (1-indexed, default 1)" }),
      ),
      limit: Type.Optional(
        Type.Number({ description: `Maximum lines to return (default ${RECALL_MAX_LINES})` }),
      ),
    }),

    async execute(_toolCallId, params) {
      const text = await store.recall(params.ref, params.offset, params.limit);
      return { content: [{ type: "text" as const, text }], details: undefined };
    },
  });
}
