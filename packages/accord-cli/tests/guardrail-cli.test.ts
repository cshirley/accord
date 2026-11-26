import { describe, expect, test } from "bun:test";
import path from "node:path";

const bin = path.join(import.meta.dir, "..", "src", "guardrail-main.ts");

async function run(args: string[], stdin?: string) {
  const p = Bun.spawn(["bun", bin, ...args], {
    stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  return { code: await p.exited, out, err };
}

describe("accord-guardrail", () => {
  test("safe command exits 0", async () => {
    expect((await run(["check", "ls -la"])).code).toBe(0);
  });
  test("high risk exits 2 with json", async () => {
    const r = await run(["check", "--json", "rm -rf /"]);
    expect(r.code).toBe(2);
    expect(JSON.parse(r.out).action).toBe("deny");
  });
  test("claude hook denies high risk", async () => {
    const r = await run(
      ["hook", "claude"],
      JSON.stringify({ tool_name: "Bash", tool_input: { command: "sudo rm -rf /" } }),
    );
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out).hookSpecificOutput.permissionDecision).toBe("deny");
  });
  test("claude hook ignores non-shell tools and bad input", async () => {
    expect(
      (await run(["hook", "claude"], JSON.stringify({ tool_name: "Read", tool_input: {} }))).out,
    ).toBe("");
    expect((await run(["hook", "claude"], "not json")).code).toBe(0);
  });
});
