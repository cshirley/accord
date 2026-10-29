import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { getLogLevel, type Logger, setLogLevel } from "../src/logging.js";
import { emitStackEvent, STACK_EVENTS } from "../src/telemetry/stack-events.js";

type Level = "debug" | "info" | "warn" | "error";

const CATALOGUE: Array<{ name: string; level: Level; fields: Record<string, string | number> }> = [
  {
    name: "stack.commit.created",
    level: "info",
    fields: { work_item_id: "ASDLC-1", ref: "red-T1", outcome: "ok", sha: "abc1234" },
  },
  {
    name: "stack.guard.rejected",
    level: "warn",
    fields: { work_item_id: "ASDLC-1", ref: "review-C1", rule: "reviews-only", path: "src/a.ts" },
  },
  {
    name: "stack.state.snapshot",
    level: "debug",
    fields: { work_item_id: "ASDLC-1", task: 3, file_count: 4, bytes: 1200, redactions: 2 },
  },
  {
    name: "stack.overrun.detected",
    level: "warn",
    fields: { work_item_id: "ASDLC-1", task: 3, est_lines: 200, act_lines: 450 },
  },
  {
    name: "stack.ci.alert",
    level: "error",
    fields: { work_item_id: "ASDLC-1", condition: "cost_cap" },
  },
];

function recorder() {
  const calls: Array<{ level: Level; message: string }> = [];
  const logger: Logger = {
    debug: (message) => calls.push({ level: "debug", message }),
    info: (message) => calls.push({ level: "info", message }),
    warn: (message) => calls.push({ level: "warn", message }),
    error: (message) => calls.push({ level: "error", message }),
  };
  return { calls, logger };
}

describe("ASDLC-1/AC-29 stack telemetry (ASDLC-1/TC-30)", () => {
  for (const { name, level, fields } of CATALOGUE) {
    it(`ASDLC-1/AC-29 ${name} emits once at ${level} with declared fields`, () => {
      const { calls, logger } = recorder();
      emitStackEvent(name, fields, logger);
      expect(calls).toHaveLength(1);
      expect(calls[0]?.level).toBe(level);
      const expected = `${name} ${Object.entries(fields)
        .map(([key, value]) => `${key}=${value}`)
        .join(" ")}`;
      expect(calls[0]?.message).toBe(expected);
    });

    it(`ASDLC-1/AC-29 ${name} catalogue entry declares exact level and fields`, () => {
      const spec = STACK_EVENTS.find((entry) => entry.name === name);
      expect(spec?.level).toBe(level);
      expect([...(spec?.fields ?? [])].sort()).toEqual(Object.keys(fields).sort());
    });

    it(`ASDLC-1/AC-29 ${name} rejects an unknown field`, () => {
      const { calls, logger } = recorder();
      expect(() => emitStackEvent(name, { ...fields, extra_field: "x" }, logger)).toThrow(
        /extra_field/,
      );
      expect(calls).toHaveLength(0);
    });

    for (const missing of Object.keys(fields)) {
      it(`ASDLC-1/AC-29 ${name} rejects missing field ${missing}`, () => {
        const { calls, logger } = recorder();
        const partial = { ...fields };
        delete partial[missing];
        expect(() => emitStackEvent(name, partial, logger)).toThrow(new RegExp(missing));
        expect(calls).toHaveLength(0);
      });
    }
  }

  it("ASDLC-1/AC-29 catalogue has exactly the five declared events", () => {
    expect(STACK_EVENTS.map((entry) => entry.name).sort()).toEqual(
      CATALOGUE.map((entry) => entry.name).sort(),
    );
  });

  it("ASDLC-1/AC-29 unknown event name throws", () => {
    const { calls, logger } = recorder();
    expect(() => emitStackEvent("stack.bogus", { work_item_id: "ASDLC-1" }, logger)).toThrow(
      /stack\.bogus/,
    );
    expect(calls).toHaveLength(0);
  });

  describe("stack.state.snapshot counts only", () => {
    const snapshot = CATALOGUE.find((entry) => entry.name === "stack.state.snapshot")?.fields ?? {};
    for (const key of ["file_count", "bytes", "redactions"]) {
      for (const bad of ["secret-content", "12", "", "1 2"]) {
        it(`ASDLC-1/AC-29 rejects non-numeric ${key}=${JSON.stringify(bad)}`, () => {
          const { calls, logger } = recorder();
          expect(() =>
            emitStackEvent("stack.state.snapshot", { ...snapshot, [key]: bad }, logger),
          ).toThrow(new RegExp(key));
          expect(calls).toHaveLength(0);
        });
      }
    }
    it("ASDLC-1/AC-29 accepts zero counts", () => {
      const { calls, logger } = recorder();
      emitStackEvent(
        "stack.state.snapshot",
        { ...snapshot, file_count: 0, bytes: 0, redactions: 0 },
        logger,
      );
      expect(calls[0]?.message).toBe(
        "stack.state.snapshot work_item_id=ASDLC-1 task=3 file_count=0 bytes=0 redactions=0",
      );
    });
  });

  describe("default shared logger (stderr)", () => {
    const original = getLogLevel();
    let errSpy: ReturnType<typeof spyOn>;
    beforeEach(() => {
      errSpy = spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => {
      errSpy.mockRestore();
      setLogLevel(original);
    });

    it("ASDLC-1/AC-29 emits through createLogger('stack') at debug level", () => {
      setLogLevel("debug");
      emitStackEvent("stack.commit.created", CATALOGUE[0]?.fields ?? {});
      expect(errSpy).toHaveBeenCalledTimes(1);
      expect(errSpy.mock.calls[0]?.[0]).toBe(
        "[accord:stack:info] stack.commit.created work_item_id=ASDLC-1 ref=red-T1 outcome=ok sha=abc1234",
      );
    });

    it("ASDLC-1/AC-29 debug snapshot is silent at default error level, error alert is not", () => {
      setLogLevel("error");
      emitStackEvent("stack.state.snapshot", CATALOGUE[2]?.fields ?? {});
      expect(errSpy).toHaveBeenCalledTimes(0);
      emitStackEvent("stack.ci.alert", CATALOGUE[4]?.fields ?? {});
      expect(errSpy).toHaveBeenCalledTimes(1);
      expect(errSpy.mock.calls[0]?.[0]).toBe(
        "[accord:stack:error] stack.ci.alert work_item_id=ASDLC-1 condition=cost_cap",
      );
    });
  });
});
