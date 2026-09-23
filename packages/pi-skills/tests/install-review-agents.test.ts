import { existsSync, lstatSync, mkdtempSync, readlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const scriptPath = join(import.meta.dir, "..", "scripts", "install-review-agents.ts");

describe("install-review-agents", () => {
  let tempTarget = "";

  afterEach(() => {
    if (tempTarget) {
      rmSync(tempTarget, { recursive: true, force: true });
      tempTarget = "";
    }
  });

  test("dry-run links three review agents from accord-assets", async () => {
    tempTarget = mkdtempSync(join(tmpdir(), "pi-skills-agent-install-"));
    const proc = Bun.spawn(
      ["bun", scriptPath, "--target", tempTarget, "--dry-run", "--force"],
      { cwd: repoRoot, stdout: "pipe", stderr: "pipe" },
    );
    const exitCode = await proc.exited;
    const stdout = await new Response(proc.stdout).text();
    expect(exitCode).toBe(0);
    expect(stdout).toContain("would link");

    const destDir = join(tempTarget, "agents", "accord");
    for (const name of ["review-code", "review-security", "review-test"]) {
      expect(existsSync(join(destDir, `${name}.md`))).toBe(false);
      expect(
        existsSync(join(repoRoot, "packages", "accord-assets", "agents", "accord", `${name}.md`)),
      ).toBe(true);
    }
  });

  test("creates symlinks under target agents/accord", async () => {
    tempTarget = mkdtempSync(join(tmpdir(), "pi-skills-agent-install-"));
    const proc = Bun.spawn(["bun", scriptPath, "--target", tempTarget, "--force"], {
      cwd: repoRoot,
      stdout: "pipe",
      stderr: "pipe",
    });
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);

    const destDir = join(tempTarget, "agents", "accord");
    for (const name of ["review-code", "review-security", "review-test"]) {
      const dst = join(destDir, `${name}.md`);
      expect(existsSync(dst)).toBe(true);
      expect(lstatSync(dst).isSymbolicLink()).toBe(true);
      const target = readlinkSync(dst);
      expect(target).toContain("accord-assets/agents/accord");
    }
  });
});
