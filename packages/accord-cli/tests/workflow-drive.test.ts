import { describe, expect, test } from "bun:test";
import { resolveWorkItemIdFromClassifyText } from "@clive.shirley/accord-core/commands/classify-dispatch.js";
import { parseCli } from "../src/cli.js";
import { planDriveStatus } from "../src/commands/drive.js";

describe("accord-cli workflow drive", () => {
  test("resolveWorkItemIdFromClassifyText parses ticket-only and ticket+title", () => {
    expect(resolveWorkItemIdFromClassifyText("ACCORD-1234")).toBe("ACCORD-1234");
    expect(resolveWorkItemIdFromClassifyText("ACCORD-1234 add refresh tokens")).toBe("ACCORD-1234");
    expect(resolveWorkItemIdFromClassifyText("implement auth")).toBeNull();
  });

  test("parse run command", () => {
    const parsed = parseCli([
      "run",
      "ACCORD-99",
      "add",
      "feature",
      "--finish",
      "--harness=exec",
      "-y",
    ]);
    expect(parsed.kind).toBe("run");
    if (parsed.kind !== "run") return;
    expect(parsed.text).toBe("ACCORD-99 add feature");
    expect(parsed.options.finish).toBe(true);
    expect(parsed.options.harness).toBe("exec");
    expect(parsed.options.yes).toBe(true);
  });

  test("parse drive command", () => {
    const parsed = parseCli(["drive", "DEMO-1", "--max-rounds=5", "--json"]);
    expect(parsed.kind).toBe("drive");
    if (parsed.kind !== "drive") return;
    expect(parsed.workItemId).toBe("DEMO-1");
    expect(parsed.options.maxRounds).toBe(5);
    expect(parsed.options.json).toBe(true);
  });

  test("planDriveStatus detects finish-ready blocked resolution", () => {
    const status = planDriveStatus("DEMO-1", {
      outcome: "blocked",
      messages: [
        {
          level: "warning",
          text: "All implementation tasks for DEMO-1 are **done**. Run `/dev finish` for acceptance.",
        },
      ],
    });
    expect(status).toBe("ready_for_finish");
  });
});
