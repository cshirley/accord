import { describe, expect, test } from "bun:test";
import { DEV_WORK_ITEM_ID_PATTERN } from "@clive.shirley/accord-core/commands/dispatch.js";
import { WORK_ITEM_FILE_PATTERN } from "@clive.shirley/accord-core/work-items/io.js";
import {
  isSyntheticWorkItemId,
  nextSyntheticWorkItemId,
} from "@clive.shirley/accord-core/work-items/synthetic.js";

const today = new Date(2026, 9, 29);

describe("synthetic work item ids", () => {
  test("first id of the day is NN=01 and matches core id patterns", () => {
    const id = nextSyntheticWorkItemId(() => false, today);
    expect(id).toBe("ADHOC-2026102901");
    expect(DEV_WORK_ITEM_ID_PATTERN.test(id)).toBe(true);
    expect(WORK_ITEM_FILE_PATTERN.test(`${id}.json`)).toBe(true);
    expect(isSyntheticWorkItemId(id)).toBe(true);
  });

  test("skips taken ids", () => {
    const taken = new Set(["ADHOC-2026102901", "ADHOC-2026102902"]);
    expect(nextSyntheticWorkItemId((c) => taken.has(c), today)).toBe("ADHOC-2026102903");
  });

  test("throws when the day is full", () => {
    expect(() => nextSyntheticWorkItemId(() => true, today)).toThrow(/No free ADHOC-20261029NN/);
  });

  test("month and day are zero-padded", () => {
    expect(nextSyntheticWorkItemId(() => false, new Date(2026, 0, 5))).toBe("ADHOC-2026010501");
    expect(nextSyntheticWorkItemId(() => false, new Date(2026, 11, 31))).toBe("ADHOC-2026123101");
  });

  test("uses the local calendar date, not UTC", () => {
    const original = process.env.TZ;
    try {
      const expectedOffsets: Record<string, number> = {
        "Pacific/Auckland": -780, // UTC+13 in January
        "America/Los_Angeles": 480, // UTC-8 in January
      };
      for (const zone of Object.keys(expectedOffsets)) {
        process.env.TZ = zone;
        // Prove the runtime honoured the zone switch, or this test would pass under UTC.
        expect(new Date(2026, 0, 5, 12).getTimezoneOffset()).toBe(expectedOffsets[zone]);
        expect(nextSyntheticWorkItemId(() => false, new Date(2026, 0, 5, 0, 30))).toBe(
          "ADHOC-2026010501",
        );
        expect(nextSyntheticWorkItemId(() => false, new Date(2026, 0, 5, 23, 30))).toBe(
          "ADHOC-2026010501",
        );
      }
    } finally {
      process.env.TZ = original ?? "Etc/UTC";
    }
  });

  test("slot 99 is usable and slot 100 is never produced", () => {
    expect(nextSyntheticWorkItemId((c) => !c.endsWith("99"), today)).toBe("ADHOC-2026102999");
    let calls = 0;
    expect(() =>
      nextSyntheticWorkItemId(() => {
        calls += 1;
        return true;
      }, today),
    ).toThrow(/No free ADHOC-20261029NN/);
    expect(calls).toBe(99);
  });

  test("real tickets and malformed ids are not synthetic", () => {
    expect(isSyntheticWorkItemId("STEP-123")).toBe(false);
    expect(isSyntheticWorkItemId("ADHOC-1")).toBe(false);
    expect(isSyntheticWorkItemId("ADHOC-2026102901-2")).toBe(false);
  });
});
