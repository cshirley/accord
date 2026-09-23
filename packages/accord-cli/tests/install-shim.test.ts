import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildAccordShimContent,
  installAccordShim,
  resolveAccordCliMain,
} from "../src/install-shim.js";

describe("install accord shim", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function makeTempBinDir(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "accord-shim-"));
    tempDirs.push(dir);
    return dir;
  }

  test("buildAccordShimContent execs bun on accord-cli main.ts", () => {
    const content = buildAccordShimContent({
      repoRoot: "/repo/accord",
      bunPath: "/opt/homebrew/bin/bun",
    });
    expect(content).toContain("#!/usr/bin/env bash");
    expect(content).toContain('exec /opt/homebrew/bin/bun /repo/accord/packages/accord-cli/src/main.ts "$@"');
  });

  test("installAccordShim writes executable shim", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "accord-repo-"));
    tempDirs.push(repoRoot);
    const mainTs = resolveAccordCliMain(repoRoot);
    await Bun.write(mainTs, "#!/usr/bin/env bun\nconsole.log('ok');\n");

    const binDir = await makeTempBinDir();
    const result = await installAccordShim({ repoRoot, binDir, bunPath: "/usr/bin/bun" });

    expect(result.written).toBe(true);
    const shim = await readFile(result.path, "utf8");
    expect(shim).toContain(mainTs);
    const mode = await Bun.file(result.path).stat();
    expect(mode.mode & 0o111).not.toBe(0);
  });

  test("installAccordShim skips when content unchanged", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "accord-repo-"));
    tempDirs.push(repoRoot);
    await Bun.write(resolveAccordCliMain(repoRoot), "export {};\n");

    const binDir = await makeTempBinDir();
    const first = await installAccordShim({ repoRoot, binDir, bunPath: "/usr/bin/bun" });
    const second = await installAccordShim({ repoRoot, binDir, bunPath: "/usr/bin/bun" });

    expect(first.written).toBe(true);
    expect(second.skipped).toBe(true);
  });

  test("installAccordShim refuses overwrite without force", async () => {
    const repoRoot = await mkdtemp(join(tmpdir(), "accord-repo-"));
    tempDirs.push(repoRoot);
    await Bun.write(resolveAccordCliMain(repoRoot), "export {};\n");

    const binDir = await makeTempBinDir();
    await installAccordShim({ repoRoot, binDir, bunPath: "/usr/bin/bun" });
    await writeFile(join(binDir, "accord"), "#!/bin/sh\nexit 1\n", "utf8");

    await expect(
      installAccordShim({ repoRoot, binDir, bunPath: "/usr/bin/bun" }),
    ).rejects.toThrow(/Refusing to overwrite/);
  });
});
