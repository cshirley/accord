/**
 * Verification runner — async command execution and result formatting.
 *
 * Used by the extension hooks to run type_check, test, and full
 * verification_commands at phase boundaries.
 */

import { exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DevHarnessConfig } from "../config/index.js";
import { agentSchemas } from "../agents/registry.js";
import { EXT_DIR } from "../config/paths.js";
import { createLogger } from "../logging.js";

const log = createLogger("verify");

// ── Types ──────────────────────────────────────────────────

export interface VerificationResult {
  command: string;
  exitCode: number;
  output: string;   // last 40 lines of combined stdout/stderr
  durationMs: number;
}

// ── Runner ─────────────────────────────────────────────────

const execAsync = promisify(execCb);

export async function runVerificationCommands(
  commands: string[],
  opts?: { timeoutMs?: number; totalTimeoutMs?: number },
): Promise<VerificationResult[]> {
  const timeout = opts?.timeoutMs ?? 120_000;
  // Default total budget: 5 × per-command timeout. With six commands at 120s
  // each, this caps verify-preflight + post-code verification at 10 minutes
  // instead of letting a slow type-checker block subagent dispatch for an
  // unbounded number of minutes.
  const totalTimeout = opts?.totalTimeoutMs ?? Math.max(timeout * 5, 600_000);
  const results: VerificationResult[] = [];
  const budgetStart = Date.now();

  for (const cmd of commands) {
    if (Date.now() - budgetStart > totalTimeout) {
      results.push({
        command: cmd,
        exitCode: 124,
        output: `[verification: skipped — total timeout of ${totalTimeout}ms exceeded after ${results.length}/${commands.length} command(s)]`,
        durationMs: 0,
      });
      continue;
    }
    const start = Date.now();
    let exitCode = 0;
    let output = "";
    try {
      const { stdout, stderr } = await execAsync(cmd, {
        timeout,
        cwd: process.cwd(),
        maxBuffer: 10 * 1024 * 1024,
      });
      output = (stdout || "") + (stderr || "");
    } catch (err: any) {
      // Distinguish three classes of failure that all land here:
      //   • normal non-zero exit  → err.code is the exit code, stdout/stderr present
      //   • timeout               → err.killed === true, signal === 'SIGTERM'
      //   • maxBuffer overflow    → err.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
      // Surface a meaningful exitCode and output for each.
      exitCode = typeof err.code === "number" ? err.code : 1;
      const stdout = typeof err.stdout === "string" ? err.stdout : "";
      const stderr = typeof err.stderr === "string" ? err.stderr : "";
      output = stdout + (stdout && stderr ? "\n" : "") + stderr;
      if (err.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") {
        exitCode = exitCode || 1;
        output = (output || "") + "\n[verification: command exceeded 10 MB stdio buffer; output truncated]";
      } else if (err.killed && err.signal === "SIGTERM") {
        exitCode = exitCode || 124;
        output = (output || "") + `\n[verification: command timed out after ${timeout}ms]`;
      } else if (!output && err.message) {
        output = String(err.message);
      }
      log.info(`command failed: ${cmd} (exit ${exitCode})`);
    }
    const lines = output.trim().split("\n");
    results.push({
      command: cmd,
      exitCode,
      output: lines.slice(-40).join("\n"),
      durationMs: Date.now() - start,
    });
  }
  return results;
}

// ── Formatting ─────────────────────────────────────────────

export function formatVerificationResults(
  results: VerificationResult[],
  label: string,
): string {
  const lines: string[] = [`\n## ${label}\n`];
  let allPass = true;
  for (const r of results) {
    const status = r.exitCode === 0 ? "✓" : "✗";
    if (r.exitCode !== 0) allPass = false;
    lines.push(`${status} \`${r.command}\` → exit ${r.exitCode} (${r.durationMs}ms)`);
    if (r.exitCode !== 0) {
      lines.push("```");
      lines.push(r.output);
      lines.push("```");
    }
  }
  lines.push("");
  lines.push(allPass
    ? "All verification commands passed."
    : "⚠ Verification failures detected — fix before proceeding.");
  return lines.join("\n");
}

// ── Schema injection ─────────────────────────────────────

const SCHEMAS_DIR = join(EXT_DIR, "schemas");

/** Cache loaded schemas in memory — intentionally unbounded since the set of
 *  schemas is small and fixed for the extension's lifetime (~20 files, <100KB total). */
const schemaCache = new Map<string, string>();

function loadSchema(relativePath: string): string {
  const cached = schemaCache.get(relativePath);
  if (cached) return cached;
  try {
    const content = readFileSync(join(SCHEMAS_DIR, relativePath), "utf8");
    schemaCache.set(relativePath, content);
    return content;
  } catch {
    return "";
  }
}

/**
 * Build a ## Schemas section for injection into an agent's brief.
 * Returns empty string if the agent has no schema mapping.
 */
export function formatSchemaBrief(agentName: string): string {
  const paths = agentSchemas(agentName);
  if (!paths.length) return "";

  const sections: string[] = ["", "## Schemas", ""];
  for (const rel of paths) {
    const content = loadSchema(rel);
    if (!content) continue;
    // Derive a readable heading: "return-schemas/phase-code.json" → "return: phase-code"
    // "spec-schema.json" → "spec-schema"
    const name = rel.includes("return-schemas/")
      ? "return: " + rel.replace("return-schemas/", "").replace(".json", "")
      : rel.replace(".json", "");
    sections.push(`### ${name}`, "", "```json", content.trim(), "```", "");

    // Inject validated examples for return schemas
    if (rel.includes("return-schemas/")) {
      const examplePath = rel.replace("return-schemas/", "examples/");
      const exampleContent = loadSchema(examplePath);
      if (exampleContent) {
        sections.push(`### ${name} (examples)`, "", "```json", exampleContent.trim(), "```", "");
      }
    }
  }
  return sections.join("\n");
}

// ── Brief injection ──────────────────────────────────────

/**
 * Format DevHarnessConfig as a markdown section for injection into
 * subagent briefs. Agents receive this as their ## Project Stack section.
 */
export function formatConfigBrief(config: DevHarnessConfig): string {
  const lines: string[] = [
    "",
    "## Project Stack (from AGENTS.md ACCORD config)",
    "",
    `- **Language:** ${config.language}`,
    `- **Test command:** \`${config.test.command}\``,
  ];
  if (config.test.single_test_flag) lines.push(`- **Single test flag:** \`${config.test.single_test_flag}\``);
  if (config.test.file_pattern) lines.push(`- **Test file pattern:** \`${config.test.file_pattern}\``);
  if (config.test.block_markers?.length) {
    lines.push(`- **Test block markers:** ${config.test.block_markers.map(m => `\`${m}\``).join(", ")}`);
  }
  lines.push(config.type_check
    ? `- **Type check:** \`${config.type_check}\``
    : `- **Type check:** _(none)_`);
  if (config.lint) lines.push(`- **Lint:** \`${config.lint}\``);
  if (config.format) lines.push(`- **Format:** \`${config.format}\``);
  lines.push(`- **Verification commands:** ${config.verification_commands.map(c => `\`${c}\``).join(", ")}`);
  if (config.monorepo) {
    lines.push(`- **Monorepo:** ${config.monorepo.tool} (root: ${config.monorepo.root || "."})`);
  }
  lines.push("");
  return lines.join("\n");
}
