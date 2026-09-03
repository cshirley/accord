import * as fs from "node:fs";
import * as path from "node:path";
import {
  resolveGlobalConfigPath,
  seedGlobalConfigFile,
} from "@clive.shirley/accord-core/config/global.js";
import { detectInstalledHarnesses } from "../config/detect-harnesses.js";
import {
  buildGlobalAccordConfig,
  formatGlobalAccordConfigJson,
} from "../config/generate-global-config.js";
import { promptHarnessSelection } from "../config/prompt-harness.js";
import { cliNotify } from "../notify.js";

export type ConfigInitOptions = {
  write?: boolean;
  defaultHarness?: string;
  yes?: boolean;
  json?: boolean;
  force?: boolean;
};

export type ConfigInitResult = {
  ok: boolean;
  path: string;
  defaultHarness: string;
  installed: string[];
  config: ReturnType<typeof buildGlobalAccordConfig>;
  written: boolean;
  message?: string;
};

export async function runConfigInitCommand(options: ConfigInitOptions = {}): Promise<number> {
  const installedBackends = detectInstalledHarnesses().filter((backend) => backend.installed);
  const installedIds = installedBackends.map((backend) => backend.id);

  let defaultHarness = options.defaultHarness?.trim().toLowerCase();
  if (!defaultHarness) {
    if (options.yes || !process.stdin.isTTY) {
      defaultHarness = installedIds[0] ?? "claude";
    } else {
      defaultHarness = await promptHarnessSelection(installedBackends);
    }
  }

  if (!installedIds.includes(defaultHarness) && installedIds.length > 0) {
    cliNotify(
      "warn",
      `Selected harness "${defaultHarness}" is not installed. Installed: ${installedIds.join(", ")}`,
    );
  }

  const config = buildGlobalAccordConfig({
    defaultHarnessId: defaultHarness,
    backends: installedBackends.length > 0 ? installedBackends : detectInstalledHarnesses(),
  });

  const targetPath = resolveGlobalConfigPath() ?? seedGlobalConfigFile().path;
  const result: ConfigInitResult = {
    ok: true,
    path: targetPath,
    defaultHarness,
    installed: installedIds,
    config,
    written: false,
  };

  if (!options.write) {
    result.message = "Dry run — pass --write to create ~/.config/accord/accord.json";
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      cliNotify("info", result.message);
      console.log(formatGlobalAccordConfigJson(config));
    }
    return 0;
  }

  if (fs.existsSync(targetPath) && !options.force) {
    result.ok = false;
    result.message = `Config already exists at ${targetPath}. Pass --force to overwrite.`;
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      cliNotify("error", result.message);
    }
    return 1;
  }

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, formatGlobalAccordConfigJson(config), "utf8");
  result.written = true;
  result.message = `Wrote ${targetPath} (default harness: ${defaultHarness})`;

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    cliNotify("info", result.message);
    cliNotify(
      "info",
      `Tiers: reasoning=${config.harness?.tiers?.reasoning?.model}, workhorse=${config.harness?.tiers?.workhorse?.model}`,
    );
  }
  return 0;
}
