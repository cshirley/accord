import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isHarnessArtifactPath, normalizeHarnessRelativePath } from "../src/core/harness/paths.js";
import {
  analyzeSessionTranscript,
  readHarnessMarkerFromSession,
} from "../src/core/queries/session-transcript.js";

describe("harness path helpers", () => {
  test("normalizeHarnessRelativePath strips repo prefix", () => {
    expect(normalizeHarnessRelativePath("/repo/apps/foo/.tasks/WI-1.json")).toBe(
      ".tasks/WI-1.json",
    );
    expect(normalizeHarnessRelativePath("/repo/docs/dev/WI-1/spec.json")).toBe(
      "docs/dev/WI-1/spec.json",
    );
  });

  test("isHarnessArtifactPath detects tasks and docs/dev", () => {
    expect(isHarnessArtifactPath(".tasks/WI-1.json")).toBe(true);
    expect(isHarnessArtifactPath("docs/dev/WI-1/spec.json")).toBe(true);
    expect(isHarnessArtifactPath("src/index.ts")).toBe(false);
  });
});

describe("analyzeSessionTranscript", () => {
  let tempRoot: string | undefined;
  let sessionPath: string | undefined;

  afterEach(() => {
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
    sessionPath = undefined;
  });

  test("reads harness marker and counts entries via SessionManager", () => {
    tempRoot = mkdtempSync(join(tmpdir(), "accord-session-"));
    sessionPath = join(tempRoot, "pi-session.jsonl");

    const header = {
      type: "session",
      version: 3,
      id: "sess-session-test",
      timestamp: "2026-08-06T16:00:00.000Z",
      cwd: tempRoot,
    };
    const markerEntry = {
      type: "custom",
      id: "e1",
      parentId: null,
      timestamp: "2026-08-06T16:00:01.000Z",
      customType: "dev-harness-run",
      data: {
        harness_run_id: "run-session-test",
        work_item_id: "WI-SESSION",
      },
    };
    const messageEntry = {
      type: "message",
      id: "e2",
      parentId: "e1",
      timestamp: "2026-08-06T16:00:02.000Z",
      message: { role: "user", content: "hello", timestamp: Date.now() },
    };
    writeFileSync(
      sessionPath,
      [header, markerEntry, messageEntry].map((entry) => JSON.stringify(entry)).join("\n") + "\n",
      "utf8",
    );

    const summary = analyzeSessionTranscript(sessionPath);
    expect(summary).not.toBeNull();
    expect(summary?.entry_count).toBeGreaterThanOrEqual(1);
    expect(summary?.harness_marker?.harness_run_id).toBe("run-session-test");
    expect(summary?.harness_marker?.work_item_id).toBe("WI-SESSION");

    const marker = readHarnessMarkerFromSession(sessionPath);
    expect(marker?.harness_run_id).toBe("run-session-test");
  });
});
