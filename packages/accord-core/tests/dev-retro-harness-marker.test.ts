import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { devRetro } from "@clive.shirley/accord-core/queries/retro.js";

describe("devRetro harness marker correlation", () => {
  const originalCwd = process.cwd();
  let tempRoot: string | undefined;

  afterEach(() => {
    process.chdir(originalCwd);
    if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = undefined;
  });

  test("classifies Pi dev-harness-run marker as marker association (not legacy heuristic)", () => {
    tempRoot = mkdtempSync(join(tmpdir(), "accord-retro-"));
    const insightsDir = join(tempRoot, "insights");
    const metaDir = join(insightsDir, "meta");
    const cacheDir = join(insightsDir, "cache");
    mkdirSync(metaDir, { recursive: true });
    mkdirSync(cacheDir, { recursive: true });

    const sessionPath = join(tempRoot, "pi-session.jsonl");
    const sessionLine = JSON.stringify({
      type: "custom",
      customType: "dev-harness-run",
      data: {
        schema_version: "1.1",
        harness_run_id: "run-retro-test",
        harness_session_tag: "WI-CORE-ORCH",
        work_item_id: "WI-CORE-ORCH",
        auto_provisioned: true,
        cwd: tempRoot,
        updated_at: "2026-05-13T12:00:00.000Z",
      },
    });
    writeFileSync(sessionPath, `${sessionLine}\n`, "utf8");

    const sessionId = "retro-marker-sess";
    writeFileSync(
      join(metaDir, `${sessionId}.json`),
      JSON.stringify({
        sessionId,
        path: sessionPath,
        cwd: tempRoot,
        timestamp: "2026-05-13T12:00:00.000Z",
        firstPrompt: "/dev resume WI-CORE-ORCH",
      }),
      "utf8",
    );
    writeFileSync(
      join(cacheDir, `${sessionId}.json`),
      JSON.stringify({ outcome: "done", friction: "none", frictionCounts: {} }),
      "utf8",
    );

    process.chdir(tempRoot);
    const result = devRetro({
      insights_dir: insightsDir,
      include_legacy_heuristic: false,
      work_item_id: "WI-CORE-ORCH",
      limit: 10,
    });

    if (!result.ok) throw new Error(result.error);
    expect(result.value.harness_sessions).toBe(1);
    expect(result.value.sessions).toHaveLength(1);
    const session = result.value.sessions[0];
    expect(session.associated_by).toBe("marker");
    expect(session.marker?.work_item_id).toBe("WI-CORE-ORCH");
    expect(session.marker?.harness_run_id).toBe("run-retro-test");
    expect(result.value.formatted).toContain("[marker]");
  });
});
