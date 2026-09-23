import { describe, expect, test } from "bun:test";
import { createCliContext } from "../src/context.js";
import { createHarness } from "../src/harnesses/registry.js";

describe("accord-cli harness lifecycle", () => {
  test("createCliContext seeds session cost state and lifecycle host", () => {
    const ctx = createCliContext(process.cwd());
    expect(ctx.state.lifecycleHost).toBeDefined();
    expect(ctx.state.costCache).toBeInstanceOf(Map);
  });

  test("createHarness wires discovered tool names and lifecycle host", () => {
    const ctx = createCliContext(process.cwd());
    const harness = createHarness({ harnessId: "exec" }, ctx, { autoConfirm: true });
    expect(harness.id).toBe("exec");
    expect(ctx.state.lifecycleHost).toBeDefined();
  });
});
