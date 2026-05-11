/**
 * Auto-install bundled Pi assets at extension startup.
 *
 * Compares the recorded `~/.config/pi/agent/.accord-assets.json`
 * metadata against the currently-loaded package's version and
 * manifest checksum. If they differ (first install, package upgrade,
 * or asset edit while linked), the bootstrap re-runs the installer
 * in-process and notifies the host that a Pi restart is required to
 * activate the freshly linked assets — Pi only scans the
 * skills/agents/providers dirs at startup.
 *
 * Opt-out precedence (first match wins):
 *   1. `ACCORD_AUTO_INSTALL_ASSETS` env var: false/0/no/off → disabled.
 *   2. Global `~/.config/pi/agent/accord-config.json`:
 *      `asset_bootstrap.auto_install: false` → disabled.
 *   3. Default: enabled.
 *
 * When disabled the bootstrap still detects drift and warns, leaving
 * the fix to the user (`bun run install:assets`).
 *
 * Behaviour matrix:
 *
 *   metadata     | enabled | action
 *   -------------+---------+-----------------------------------
 *   matches      | -       | silent no-op
 *   missing      | yes     | install + notify "restart pi"
 *   missing      | no      | warn "run install:assets"
 *   mismatched   | yes     | re-install + notify "restart pi"
 *   mismatched   | no      | warn "run install:assets"
 *   conflicts    | -       | warn "run with --force"
 */

import { loadGlobalConfig } from "../config/global.js";
import type { DevHarnessGlobalConfig } from "../config/types.js";
import { createLogger } from "../logging.js";
import {
  currentAssetSignature,
  installPiAssets,
  readInstalledMetadata,
  type AccordAssetsMetadata,
  type InstallResult,
} from "../asset-install.js";
import type { HarnessHost } from "./types.js";

const log = createLogger("bootstrap");

export type AssetBootstrapStatus =
  | "current"
  | "installed"
  | "conflicts"
  | "skipped-by-env"
  | "missing-assets-warning"
  | "error";

export interface AssetBootstrapResult {
  status: AssetBootstrapStatus;
  /** Number of destination paths newly linked (0 when no install ran). */
  linked: number;
  /** Number of conflicts that blocked the install. */
  conflicts: number;
  /** Underlying install result when an install actually ran. */
  install?: InstallResult;
  /** Human-readable summary suitable for logs/tests. */
  message: string;
}

/**
 * Resolve whether the auto-installer should run for this session.
 *
 * Precedence (first defined wins):
 *   1. ACCORD_AUTO_INSTALL_ASSETS env var (false/0/no/off → disabled,
 *      true/1/yes/on → enabled).
 *   2. Global config asset_bootstrap.auto_install (boolean).
 *   3. Default: enabled.
 *
 * Returns both the resolved decision and the source so callers can
 * mention it in user-facing notifications.
 */
function resolveAutoInstall(
  env: NodeJS.ProcessEnv,
  globalConfig: DevHarnessGlobalConfig | null,
): { enabled: boolean; source: "env" | "config" | "default" } {
  const raw = env.ACCORD_AUTO_INSTALL_ASSETS;
  if (raw !== undefined) {
    const v = raw.trim().toLowerCase();
    if (v === "false" || v === "0" || v === "no" || v === "off") {
      return { enabled: false, source: "env" };
    }
    if (v === "true" || v === "1" || v === "yes" || v === "on") {
      return { enabled: true, source: "env" };
    }
  }
  const cfg = globalConfig?.asset_bootstrap?.auto_install;
  if (typeof cfg === "boolean") {
    return { enabled: cfg, source: "config" };
  }
  return { enabled: true, source: "default" };
}

function safeLoadGlobalConfig(): DevHarnessGlobalConfig | null {
  try {
    return loadGlobalConfig();
  } catch {
    return null;
  }
}

function metadataMatches(
  installed: AccordAssetsMetadata | null,
  current: { version: string; manifest_sha256: string },
): boolean {
  if (!installed) return false;
  return installed.version === current.version && installed.manifest_sha256 === current.manifest_sha256;
}

export interface BootstrapOptions {
  /** Override the Pi config target dir (defaults to ~/.config/pi/agent via the installer). */
  target?: string;
  /** Override the package root (mainly for tests). */
  packageRoot?: string;
  /** Override env lookup (mainly for tests). */
  env?: NodeJS.ProcessEnv;
  /**
   * Override the global config (mainly for tests). When undefined, the
   * bootstrap reads `~/.config/pi/agent/accord-config.json` via
   * `loadGlobalConfig()`.
   */
  globalConfig?: DevHarnessGlobalConfig | null;
}

/**
 * Run the asset bootstrap. Designed to be fire-and-forget at
 * extension activation. Never throws; surface any failure through the
 * `error` status and a `host.notify("warning", ...)` call.
 */
export function maybeAutoInstallAssets(
  host: HarnessHost,
  opts: BootstrapOptions = {},
): AssetBootstrapResult {
  let current: { version: string; manifest_sha256: string };
  try {
    current = currentAssetSignature(opts.packageRoot);
  } catch (e) {
    const msg = `ACCORD: cannot read bundled manifest (${e instanceof Error ? e.message : String(e)}). Run \`bun install\` in the extension repo.`;
    log.debug(`asset bootstrap aborted: ${msg}`);
    host.notify?.("warning", msg);
    return { status: "error", linked: 0, conflicts: 0, message: msg };
  }

  const installed = readInstalledMetadata(opts.target);
  if (metadataMatches(installed, current)) {
    log.debug(
      `bundled assets match installed metadata (v${current.version}, manifest_sha256=${current.manifest_sha256.slice(0, 8)}...); no install`,
    );
    return {
      status: "current",
      linked: 0,
      conflicts: 0,
      message: `ACCORD: bundled assets up to date (v${current.version}).`,
    };
  }

  const reason = installed ? "stale" : "missing";
  log.debug(
    installed
      ? `metadata out of date: installed v${installed.version} vs bundled v${current.version}`
      : "no install metadata at target; treating as missing",
  );

  const globalConfig =
    opts.globalConfig !== undefined ? opts.globalConfig : safeLoadGlobalConfig();
  const auto = resolveAutoInstall(opts.env ?? process.env, globalConfig);
  if (!auto.enabled) {
    const suffix =
      auto.source === "config"
        ? " (disabled by accord-config.json)"
        : auto.source === "env"
          ? " (disabled by ACCORD_AUTO_INSTALL_ASSETS)"
          : "";
    const msg = installed
      ? `ACCORD: bundled assets are stale (installed v${installed.version}, current v${current.version})${suffix}. Run \`bun run install:assets\` and restart pi.`
      : `ACCORD: bundled assets are not installed${suffix}. Run \`bun run install:assets\` and restart pi.`;
    log.debug(
      `auto-install skipped (source=${auto.source}, enabled=false); user notify=${Boolean(host.notify)}`,
    );
    host.notify?.("warning", msg);
    return { status: "skipped-by-env", linked: 0, conflicts: 0, message: msg };
  }

  log.debug(
    `running installPiAssets (auto-install source=${auto.source}, reason=${reason})`,
  );

  let result: InstallResult;
  try {
    result = installPiAssets({ target: opts.target, packageRoot: opts.packageRoot });
  } catch (e) {
    const msg = `ACCORD: asset install failed (${e instanceof Error ? e.message : String(e)}). Run \`bun run install:assets\` manually for details.`;
    log.debug(`installPiAssets threw: ${msg}`);
    host.notify?.("warning", msg);
    return { status: "error", linked: 0, conflicts: 0, message: msg };
  }

  if (result.conflicts.length > 0) {
    const list = result.conflicts.slice(0, 5).join(", ");
    const more = result.conflicts.length > 5 ? `, +${result.conflicts.length - 5} more` : "";
    const msg = `ACCORD: ${result.conflicts.length} bundled asset(s) blocked by local modifications (${list}${more}). Run \`bun run install:assets --force\` to overwrite.`;
    log.debug(`install blocked: ${result.conflicts.length} path conflict(s)`);
    host.notify?.("warning", msg);
    return {
      status: "conflicts",
      linked: result.linked.length,
      conflicts: result.conflicts.length,
      install: result,
      message: msg,
    };
  }

  if (result.linked.length === 0) {
    // Edge case: metadata mismatched but installer found everything already
    // in place (e.g. user re-ran the script externally). Treat as current.
    log.debug(
      `metadata drift but installPiAssets linked 0 paths; treating as reconciled (v${current.version})`,
    );
    return {
      status: "current",
      linked: 0,
      conflicts: 0,
      install: result,
      message: `ACCORD: bundled assets reconciled (v${current.version}, no relink needed).`,
    };
  }

  const verb = reason === "missing" ? "linked" : "re-linked";
  const msg = `ACCORD: ${verb} ${result.linked.length} bundled asset(s) (v${current.version}) — restart pi to activate.`;
  log.debug(`${verb} ${result.linked.length} asset path(s); notifying host to restart pi`);
  host.notify?.("info", msg);
  return {
    status: "installed",
    linked: result.linked.length,
    conflicts: 0,
    install: result,
    message: msg,
  };
}
