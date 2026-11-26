import { describe, expect, test } from "bun:test";
import path from "node:path";

const bin = path.join(import.meta.dir, "..", "src", "main.ts");
async function run(args: string[]) {
  const p = Bun.spawn(["bun", bin, ...args], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(p.stdout).text();
  return { code: await p.exited, out };
}

describe("accord-tools", () => {
  test("list includes git and integration tools", async () => {
    const r = await run(["list", "--json"]);
    expect(r.code).toBe(0);
    const names = (JSON.parse(r.out) as { name: string }[]).map((t) => t.name);
    expect(names).toContain("repo_verify");
    expect(names).toContain("atlassian-getJiraIssue");
  });
  test("unknown tool exits 64", async () => {
    expect((await run(["run", "nope"])).code).toBe(64);
  });
  test("runs a git tool headlessly", async () => {
    const r = await run([
      "run",
      "repo_harness_context",
      "--cwd",
      path.join(import.meta.dir, "..", "..", ".."),
    ]);
    expect(JSON.parse(r.out)).toHaveProperty("ok");
  });
});
