#!/usr/bin/env bun
/**
 * `act` wrapper that auto-detects a Docker-compatible socket and surfaces
 * a clear error when none is reachable.
 *
 * Rationale: `act` hard-codes `unix:///var/run/docker.sock`, which works
 * for Docker Desktop on macOS but not for Rancher Desktop, Colima,
 * OrbStack, or any rootless install. Asking maintainers to remember the
 * right `DOCKER_HOST` for their setup is friction we don't need.
 *
 * Resolution order:
 *   1. Honour an explicit `DOCKER_HOST` if the caller set it.
 *   2. Pick the first reachable socket from a known list (Docker Desktop,
 *      Rancher Desktop, Colima, OrbStack, generic rootless).
 *   3. Fall back to `/var/run/docker.sock` and let act produce its own
 *      error if even that is missing — preserves act's UX for the
 *      default case.
 *
 * "Reachable" means: the socket file exists AND `docker info` succeeds
 * via that host. We don't trust a stale socket left behind by a dead
 * daemon.
 */

import { spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const KNOWN_SOCKETS: ReadonlyArray<{ readonly path: string; readonly label: string }> = [
  // Docker Desktop / generic install — checked first so we don't second-guess a
  // working default.
  { path: "/var/run/docker.sock", label: "Docker Desktop / generic" },
  // Rancher Desktop (moby runtime).
  { path: join(homedir(), ".rd/docker.sock"), label: "Rancher Desktop" },
  // Colima.
  { path: join(homedir(), ".colima/default/docker.sock"), label: "Colima (default profile)" },
  // OrbStack.
  { path: join(homedir(), ".orbstack/run/docker.sock"), label: "OrbStack" },
  // Linux rootless.
  { path: `/run/user/${process.getuid?.() ?? -1}/docker.sock`, label: "rootless Docker" },
];

interface SocketProbeResult {
  readonly path: string;
  readonly label: string;
  readonly reachable: boolean;
  readonly reason?: string;
}

function isSocket(path: string): boolean {
  try {
    return statSync(path).isSocket();
  } catch {
    return false;
  }
}

async function probeSocket(socketPath: string): Promise<boolean> {
  // `docker info` against a specific host is the cheapest "is the daemon
  // alive" check. A timeout protects against a hung daemon.
  return new Promise<boolean>((resolve) => {
    const child = spawn("docker", ["info"], {
      env: { ...process.env, DOCKER_HOST: `unix://${socketPath}` },
      stdio: ["ignore", "ignore", "ignore"],
    });
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve(false);
    }, 3000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

async function resolveDockerHost(): Promise<{
  readonly host: string | null;
  readonly probes: SocketProbeResult[];
}> {
  const probes: SocketProbeResult[] = [];

  // Honour an explicit DOCKER_HOST if the caller set one.
  const explicit = process.env.DOCKER_HOST;
  if (explicit) {
    const explicitPath = explicit.startsWith("unix://") ? explicit.slice("unix://".length) : null;
    if (explicitPath && isSocket(explicitPath) && (await probeSocket(explicitPath))) {
      return { host: explicit, probes };
    }
    probes.push({
      path: explicit,
      label: "explicit $DOCKER_HOST",
      reachable: false,
      reason: explicitPath
        ? "socket missing or daemon unreachable"
        : "non-unix DOCKER_HOST left as-is for act to handle",
    });
    // Non-unix DOCKER_HOST (e.g. tcp://) — surrender control to act.
    if (!explicitPath) return { host: explicit, probes };
  }

  for (const candidate of KNOWN_SOCKETS) {
    if (!existsSync(candidate.path)) {
      probes.push({ ...candidate, reachable: false, reason: "socket not present" });
      continue;
    }
    if (!isSocket(candidate.path)) {
      probes.push({ ...candidate, reachable: false, reason: "path exists but is not a socket" });
      continue;
    }
    const ok = await probeSocket(candidate.path);
    probes.push({ ...candidate, reachable: ok, reason: ok ? undefined : "daemon not responding" });
    if (ok) {
      return { host: `unix://${candidate.path}`, probes };
    }
  }

  return { host: null, probes };
}

function formatProbeTable(probes: ReadonlyArray<SocketProbeResult>): string {
  if (probes.length === 0) return "  (no probes recorded)";
  return probes
    .map(
      (p) =>
        `  - ${p.label.padEnd(32)} ${p.path.padEnd(60)} ${p.reachable ? "OK" : `FAIL — ${p.reason ?? "unknown"}`}`,
    )
    .join("\n");
}

async function main(argv: ReadonlyArray<string>): Promise<number> {
  const { host, probes } = await resolveDockerHost();
  if (host === null) {
    const lines = [
      "smoke-act: no Docker-compatible socket reachable",
      "",
      "Probed:",
      formatProbeTable(probes),
      "",
      "Fix: start Docker Desktop / Rancher Desktop / Colima / OrbStack and re-run.",
      "Or:  export DOCKER_HOST=unix:///path/to/docker.sock and re-run.",
    ];
    process.stderr.write(`${lines.join("\n")}\n`);
    return 2;
  }

  const env = { ...process.env, DOCKER_HOST: host };
  return new Promise<number>((resolve) => {
    const child = spawn("act", argv, { env, stdio: "inherit" });
    child.on("exit", (code, signal) => {
      if (signal !== null) {
        process.stderr.write(`smoke-act: act terminated by signal ${signal}\n`);
        resolve(128);
        return;
      }
      resolve(code ?? 0);
    });
    child.on("error", (err) => {
      const reason = err instanceof Error ? err.message : String(err);
      process.stderr.write(`smoke-act: failed to spawn act: ${reason}\n`);
      resolve(127);
    });
  });
}

const argv = process.argv.slice(2);
process.exit(await main(argv));
