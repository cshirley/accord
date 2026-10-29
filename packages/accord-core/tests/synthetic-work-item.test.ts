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

  test("real tickets and malformed ids are not synthetic", () => {
    expect(isSyntheticWorkItemId("STEP-123")).toBe(false);
    expect(isSyntheticWorkItemId("ADHOC-1")).toBe(false);
    expect(isSyntheticWorkItemId("ADHOC-2026102901-2")).toBe(false);
  });
});
