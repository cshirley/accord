import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { loadGlobalConfig, resolveGlobalConfigPath } from "../src/config/global.js";
import {
  resolveLegacyGlobalConfigPath,
  resolveNeutralGlobalConfigPath,
} from "../src/config/paths.js";

describe("global config paths", () => {
  const previousAccordDir = process.env.ACCORD_CONFIG_DIR;
  const previousPiDir = process.env.ACCORD_PI_AGENT_DIR;
  let tempRoot = "";

  afterEach(() => {
    if (previousAccordDir === undefined) delete process.env.ACCORD_CONFIG_DIR;
    else process.env.ACCORD_CONFIG_DIR = previousAccordDir;
    if (previousPiDir === undefined) delete process.env.ACCORD_PI_AGENT_DIR;
    else process.env.ACCORD_PI_AGENT_DIR = previousPiDir;
    if (tempRoot) fs.rmSync(tempRoot, { recursive: true, force: true });
    tempRoot = "";
  });

  test("prefers host-neutral config path over legacy pi path", () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "accord-config-"));
    const accordDir = path.join(tempRoot, "accord");
    const legacyDir = path.join(tempRoot, "pi", "agent");
    fs.mkdirSync(accordDir, { recursive: true });
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(accordDir, "accord.json"), '{"orchestration":{}}');
    fs.writeFileSync(path.join(legacyDir, "accord.json"), '{"providers":[]}');

    process.env.ACCORD_CONFIG_DIR = accordDir;
    process.env.ACCORD_PI_AGENT_DIR = legacyDir;

    expect(resolveGlobalConfigPath()).toBe(path.join(accordDir, "accord.json"));
    expect(loadGlobalConfig()).toEqual({ orchestration: {} });
    expect(resolveNeutralGlobalConfigPath()).toBe(path.join(accordDir, "accord.json"));
    expect(resolveLegacyGlobalConfigPath()).toBe(path.join(legacyDir, "accord.json"));
  });

  test("falls back to legacy pi config when neutral path missing", () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "accord-config-"));
    const accordDir = path.join(tempRoot, "accord");
    const legacyDir = path.join(tempRoot, "pi", "agent");
    fs.mkdirSync(legacyDir, { recursive: true });
    fs.writeFileSync(path.join(legacyDir, "accord.json"), '{"providers":[]}');

    process.env.ACCORD_CONFIG_DIR = accordDir;
    process.env.ACCORD_PI_AGENT_DIR = legacyDir;

    expect(resolveGlobalConfigPath()).toBe(path.join(legacyDir, "accord.json"));
    expect(loadGlobalConfig()).toEqual({ providers: [] });
  });
});
