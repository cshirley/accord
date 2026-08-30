import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getDevSubcommandOwner } from "../src/core/commands/subcommand-routing.js";
import { acceptDeviation } from "../src/core/queries/deviation-actions.js";
import { devDeviations } from "../src/core/queries/deviations.js";
import { devGaps } from "../src/core/queries/gaps.js";

const project = join(import.meta.dir, ".tmp-gaps-deviations");
const tasksDir = join(project, ".tasks");
const docsDir = join(project, "docs", "dev", "GAP-1");

function setup() {
  rmSync(project, { recursive: true, force: true });
  mkdirSync(tasksDir, { recursive: true });
  mkdirSync(docsDir, { recursive: true });
  process.chdir(project);
}

afterEach(() => {
  process.chdir(import.meta.dir);
  rmSync(project, { recursive: true, force: true });
});

describe("gaps and deviations routing", () => {
  test("subcommands are extension-local", () => {
    expect(getDevSubcommandOwner("gaps")).toBe("extension_local");
    expect(getDevSubcommandOwner("deviations")).toBe("extension_local");
  });
});

describe("devGaps", () => {
  test("lists gaps from verify.json", () => {
    setup();
    writeFileSync(
      join(docsDir, "verify.json"),
      JSON.stringify({
        verdict: "gaps",
        criteria: [
          { ac_id: "AC-1", status: "fail", gap: "missing test", suggested_action: "add test" },
        ],
      }),
    );
    writeFileSync(
      join(tasksDir, "GAP-1.json"),
      JSON.stringify({
        id: "GAP-1",
        verify: "docs/dev/GAP-1/verify.json",
      }),
    );

    const result = devGaps("GAP-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.gap_count).toBe(1);
    expect(result.value.formatted).toContain("AC-1");
    expect(result.value.spawn_tickets).toBe(false);
    expect(result.value.formatted).toContain("--tickets");
  });
});

describe("devDeviations", () => {
  test("lists pending deviations", () => {
    setup();
    writeFileSync(
      join(tasksDir, "GAP-1.json"),
      JSON.stringify({
        id: "GAP-1",
        title: "Test",
        deviations: [
          {
            task_id: 2,
            description: "Renamed helper",
            reason: "clearer API",
            at: "2026-05-28T12:00:00.000Z",
          },
        ],
      }),
    );

    const result = devDeviations("GAP-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.action).toBe("list");
    expect(result.value.formatted).toContain("task-2");
    expect(result.value.formatted).toContain("Renamed helper");
  });

  test("accept records plan guidance", () => {
    setup();
    const planPath = "docs/dev/GAP-1/plan.json";
    writeFileSync(
      join(planPath),
      JSON.stringify({
        schema_version: "1.0",
        work_item_id: "GAP-1",
        spec: "docs/dev/GAP-1/spec.json",
        tasks: [],
        guidance: [],
      }),
    );
    writeFileSync(
      join(tasksDir, "GAP-1.json"),
      JSON.stringify({
        id: "GAP-1",
        plan: planPath,
        deviations: [
          {
            task_id: 1,
            description: "Used SQLite",
            reason: "local dev",
            at: "2026-05-28T12:00:00.000Z",
          },
        ],
      }),
    );

    const result = acceptDeviation("GAP-1", 1);
    expect(result.ok).toBe(true);

    const listed = devDeviations("GAP-1 accept 1");
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      expect(listed.value.action).toBe("accept");
    }
  });
});
