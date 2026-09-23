/**
 * Spec-gaps — 10-point checklist run deterministically against spec JSON.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { err, ok, type Result } from "../types/result.js";
import { loadWorkItem, readJson } from "../work-items/io.js";

export interface SpecGapResult {
  check: string;
  layer: string;
  status: "covered" | "out-of-scope" | "silent" | "violation";
  detail: string;
}

export interface SpecGapsResult {
  results: SpecGapResult[];
  has_violations: boolean;
  has_silent: boolean;
  formatted: string;
}

function resolveSpecPath(id: string): string | null {
  const wi = loadWorkItem(id);
  const candidates = [
    wi?.spec,
    path.join("docs", "dev", id, "spec.json"),
    // Legacy layout, kept as a read-only fallback for older runs.
    path.join("docs", "specs", `${id}-spec.json`),
  ].filter((p): p is string => Boolean(p));

  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function devSpecGaps(id: string): Result<SpecGapsResult> {
  const specPath = resolveSpecPath(id);
  if (!specPath) {
    return err(
      `Spec not found for ${id}. Tried wi.spec, docs/dev/${id}/spec.json, docs/specs/${id}-spec.json.`,
    );
  }
  const spec = readJson<Record<string, unknown>>(specPath);
  if (!spec) return err(`Spec not readable: ${specPath}`);

  const results: SpecGapResult[] = [];
  const scopeOut = (
    ((spec.scope as Record<string, unknown> | undefined)?.out as unknown[] | undefined) ?? []
  ).map((e: unknown) =>
    typeof e === "string"
      ? e.toLowerCase()
      : String(
          (e as Record<string, unknown>).item || (e as Record<string, unknown>).reason || "",
        ).toLowerCase(),
  );
  // Word-boundary match so e.g. keyword "ci" does not falsely match
  // "specific" or "explicit" inside a scope.out item.
  const hasScope = (keyword: string) => {
    const re = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    return scopeOut.some((s: string) => re.test(s));
  };

  const infra = (spec.infra_and_tooling as Record<string, unknown> | undefined) ?? {};
  const security = (spec.security_topology as Record<string, unknown> | undefined) ?? {};
  const devErgo = (spec.dev_ergonomics as Record<string, unknown> | undefined) ?? {};
  const testTopo = (spec.test_topology as Record<string, unknown> | undefined) ?? {};
  const verification = (spec.verification as Record<string, unknown> | undefined) ?? {};
  const secrets = (security.secrets as unknown[] | undefined) ?? [];
  const commands = (verification.commands as string[] | undefined) ?? [];
  const testCases = (verification.test_cases as unknown[] | undefined) ?? [];

  // 1. Monorepo scaffolding
  if (infra.monorepo_scaffold) {
    results.push({
      check: "Monorepo scaffolding",
      layer: "infra",
      status: "covered",
      detail: `monorepo_scaffold = "${infra.monorepo_scaffold}"`,
    });
  } else if (hasScope("monorepo") || hasScope("workspace")) {
    results.push({
      check: "Monorepo scaffolding",
      layer: "infra",
      status: "out-of-scope",
      detail: "scope.out mentions monorepo/workspace",
    });
  } else {
    results.push({
      check: "Monorepo scaffolding",
      layer: "infra",
      status: "silent",
      detail: "no capture, no scope.out entry",
    });
  }

  // 2. Package manager + runtime pin
  if (infra.package_manager && infra.runtime_version) {
    results.push({
      check: "Package manager + runtime pin",
      layer: "infra",
      status: "covered",
      detail: `${infra.package_manager}, ${infra.runtime_version}`,
    });
  } else if (hasScope("package") || hasScope("runtime")) {
    results.push({
      check: "Package manager + runtime pin",
      layer: "infra",
      status: "out-of-scope",
      detail: "scope.out entry",
    });
  } else {
    results.push({
      check: "Package manager + runtime pin",
      layer: "infra",
      status: "silent",
      detail: "missing package_manager or runtime_version",
    });
  }

  // 3. CI workflow
  const requiredWorkflows = (infra.required_workflows as unknown[] | undefined) ?? [];
  if (infra.ci_platform && requiredWorkflows.length > 0) {
    results.push({
      check: "CI workflow",
      layer: "infra",
      status: "covered",
      detail: `${infra.ci_platform}, ${requiredWorkflows.length} workflows`,
    });
  } else if (infra.ci_in_v1 === false) {
    const outEntry = scopeOut.find((s: string) => s.includes("ci"));
    results.push({
      check: "CI workflow",
      layer: "infra",
      status: outEntry ? "out-of-scope" : "silent",
      detail: outEntry ? "scope.out: CI deferred" : "ci_in_v1=false but no scope.out entry",
    });
  } else if (hasScope("ci")) {
    results.push({
      check: "CI workflow",
      layer: "infra",
      status: "out-of-scope",
      detail: "scope.out mentions CI",
    });
  } else {
    results.push({
      check: "CI workflow",
      layer: "infra",
      status: "silent",
      detail: "no CI capture",
    });
  }

  // 4. Secret topology
  if (secrets.length > 0) {
    const tiers = secrets.map((s) => String((s as Record<string, unknown>).tier)).join(", ");
    results.push({
      check: "Secret topology",
      layer: "security",
      status: "covered",
      detail: `${secrets.length} secrets (${tiers})`,
    });
  } else if (hasScope("secret") || hasScope("env var")) {
    results.push({
      check: "Secret topology",
      layer: "security",
      status: "out-of-scope",
      detail: "scope.out entry",
    });
  } else {
    results.push({
      check: "Secret topology",
      layer: "security",
      status: "silent",
      detail: "no secrets[] populated",
    });
  }

  // 5. Startup-failure ACs
  const requiredEnvVars = secrets.filter(
    (s) => (s as Record<string, unknown>).tier === "server-only",
  );
  const constraintACs = ((spec.acceptance_criteria as unknown[] | undefined) ?? []).filter(
    (ac) =>
      (ac as Record<string, unknown>).type === "constraint" &&
      /fail.*start|required.*env|must.*set|missing.*env/i.test(
        String((ac as Record<string, unknown>).criterion || ""),
      ),
  );
  if (requiredEnvVars.length === 0 || constraintACs.length >= requiredEnvVars.length) {
    results.push({
      check: "Startup-failure ACs",
      layer: "security",
      status: "covered",
      detail: `${constraintACs.length} constraint ACs for ${requiredEnvVars.length} required env vars`,
    });
  } else {
    results.push({
      check: "Startup-failure ACs",
      layer: "security",
      status: "violation",
      detail: `${requiredEnvVars.length} required env vars but only ${constraintACs.length} startup-failure ACs`,
    });
  }

  // 6. Client-bundle discipline
  const clientUnsafe = secrets.filter(
    (s) =>
      (s as Record<string, unknown>).tier !== "server-only" &&
      (s as Record<string, unknown>).tier !== "ci-only",
  );
  const archACs = ((spec.acceptance_criteria as unknown[] | undefined) ?? []).filter(
    (ac) =>
      (ac as Record<string, unknown>).type === "architectural" &&
      /client|bundle|NEXT_PUBLIC|browser/i.test(
        String((ac as Record<string, unknown>).criterion || ""),
      ),
  );
  if (clientUnsafe.length === 0 || archACs.length > 0) {
    results.push({
      check: "Client-bundle discipline",
      layer: "security",
      status: "covered",
      detail:
        clientUnsafe.length === 0
          ? "no client-exposed secrets"
          : `${archACs.length} architectural ACs`,
    });
  } else if (hasScope("client") || hasScope("bundle")) {
    results.push({
      check: "Client-bundle discipline",
      layer: "security",
      status: "out-of-scope",
      detail: "scope.out entry",
    });
  } else {
    results.push({
      check: "Client-bundle discipline",
      layer: "security",
      status: "violation",
      detail: `${clientUnsafe.length} non-server-only secrets but no client-bundle AC`,
    });
  }

  // 7. Dev-mode auth
  if (devErgo.local_auth_mode) {
    results.push({
      check: "Dev-mode auth",
      layer: "ergonomics",
      status: "covered",
      detail: `local_auth_mode = "${devErgo.local_auth_mode}"`,
    });
  } else if (hasScope("auth") || hasScope("local")) {
    results.push({
      check: "Dev-mode auth",
      layer: "ergonomics",
      status: "out-of-scope",
      detail: "scope.out entry",
    });
  } else {
    results.push({
      check: "Dev-mode auth",
      layer: "ergonomics",
      status: "silent",
      detail: "no capture, no scope.out entry",
    });
  }

  // 8. Test topology
  if (testTopo.unit_location && testTopo.e2e_location) {
    results.push({
      check: "Test topology",
      layer: "test",
      status: "covered",
      detail: `unit: ${testTopo.unit_location}, e2e: ${testTopo.e2e_location}`,
    });
  } else if (testTopo.unit_location) {
    results.push({
      check: "Test topology",
      layer: "test",
      status: "covered",
      detail: `unit: ${testTopo.unit_location} (no e2e)`,
    });
  } else if (hasScope("test")) {
    results.push({
      check: "Test topology",
      layer: "test",
      status: "out-of-scope",
      detail: "scope.out entry",
    });
  } else {
    results.push({
      check: "Test topology",
      layer: "test",
      status: "silent",
      detail: "test_topology not populated",
    });
  }

  // 9. verification.commands ↔ TC coverage
  if (commands.length === 0 || testCases.length === 0) {
    results.push({
      check: "verification.commands ↔ TC coverage",
      layer: "test",
      status: commands.length === 0 ? "silent" : "violation",
      detail:
        commands.length === 0 ? "no verification.commands" : "commands exist but no test_cases",
    });
  } else {
    // Check each command has at least one TC with a matching tier
    const e2ePattern = /playwright|cypress|selenium|puppeteer/i;
    const unmatchedCmds = commands.filter((cmd: string) => {
      if (e2ePattern.test(cmd))
        return !testCases.some((tc) => (tc as Record<string, unknown>).tier === "e2e");
      // Non-e2e commands match if any unit or integration TC exists
      return !testCases.some(
        (tc) =>
          (tc as Record<string, unknown>).tier === "unit" ||
          (tc as Record<string, unknown>).tier === "integration",
      );
    });
    if (unmatchedCmds.length === 0) {
      results.push({
        check: "verification.commands ↔ TC coverage",
        layer: "test",
        status: "covered",
        detail: `${commands.length} commands, ${testCases.length} TCs`,
      });
    } else {
      results.push({
        check: "verification.commands ↔ TC coverage",
        layer: "test",
        status: "violation",
        detail: `commands without matching TCs: ${unmatchedCmds.join(", ")}`,
      });
    }
  }

  // 10. E2E scenario ACs
  const hasE2ECmd = commands.some((cmd: string) =>
    /playwright|cypress|selenium|puppeteer/i.test(cmd),
  );
  const hasE2ETc = testCases.some((tc) => (tc as Record<string, unknown>).tier === "e2e");
  if (!hasE2ECmd) {
    results.push({
      check: "E2E scenario ACs",
      layer: "test",
      status: "covered",
      detail: "no e2e command in verification.commands",
    });
  } else if (hasE2ETc) {
    results.push({
      check: "E2E scenario ACs",
      layer: "test",
      status: "covered",
      detail: "e2e command has matching e2e-tier TC(s)",
    });
  } else {
    results.push({
      check: "E2E scenario ACs",
      layer: "test",
      status: "violation",
      detail: "verification.commands lists e2e tool but no e2e-tier TC",
    });
  }

  const hasViolations = results.some((r) => r.status === "violation");
  const hasSilent = results.some((r) => r.status === "silent");

  const statusIcons: Record<string, string> = {
    covered: "✓ covered",
    "out-of-scope": "✓ out-of-scope",
    silent: "⚠ silent",
    violation: "✗ violation",
  };
  const lines = [`${id} spec-gaps\n`];
  for (const r of results) lines.push(`  [${statusIcons[r.status]}]  ${r.check} — ${r.detail}`);
  if (hasViolations)
    lines.push(
      "\nRun /dev amend-spec to address violations, or /dev spec to continue the interview.",
    );
  else if (hasSilent)
    lines.push("\nSilent items are warnings — consider addressing them in the spec.");

  return ok({
    results,
    has_violations: hasViolations,
    has_silent: hasSilent,
    formatted: lines.join("\n"),
  });
}
