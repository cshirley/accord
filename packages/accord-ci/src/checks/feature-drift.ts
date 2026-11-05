import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadDevHarnessConfig } from "@clive.shirley/accord-core/config/agents-md.js";
import type { DevHarnessConfig } from "@clive.shirley/accord-core/config/index.js";
import { resolveKnowledgeConfig } from "@clive.shirley/accord-core/config/stack-flags.js";
import { checkDrift } from "@clive.shirley/accord-core/knowledge/drift.js";
import { loadFeatureDocs } from "@clive.shirley/accord-core/knowledge/feature-doc.js";
import type { EvidenceContext, EvidenceRule, RuleOutcome } from "../evidence-check.js";

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 256 * 1024 * 1024;
const DECLARATION = /^Feature-Unchanged:[ \t]*(.+)$/gim;

export interface FeatureDriftRuleOptions {
  /** Harness config; defaults to the config loaded from `cwd`. */
  config?: DevHarnessConfig | null;
  /** Report sink for warn-mode drift (default: a `::warning::` line on stdout). */
  warn?: (line: string) => void;
}

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: MAX_BUFFER });
  return stdout;
}

const lines = (text: string): string[] => text.split("\n").filter((line) => line !== "");

function declaredSlugs(log: string): string[] {
  const slugs: string[] = [];
  for (const match of log.matchAll(DECLARATION)) {
    slugs.push(...(match[1] ?? "").split(/[\s,]+/).filter((slug) => slug !== ""));
  }
  return slugs;
}

export function createFeatureDriftRule(
  cwd: string = process.cwd(),
  options: FeatureDriftRuleOptions = {},
): EvidenceRule {
  const warn = options.warn ?? ((line: string) => console.log(`::warning::${line}`));
  return {
    name: "feature-drift",
    async run(ctx: EvidenceContext): Promise<RuleOutcome> {
      const config = options.config === undefined ? loadDevHarnessConfig(cwd) : options.config;
      const knowledge = resolveKnowledgeConfig(config);
      if (!knowledge.enabled || knowledge.drift_check === "off") return { ok: true };

      let mergeBase: string;
      let changed: string[];
      let declared: string[];
      try {
        const base = (await git(["rev-parse", "--verify", `${ctx.base}^{commit}`], cwd)).trim();
        mergeBase = (await git(["merge-base", base, ctx.head], cwd)).trim();
        changed = lines(
          await git(["diff", "--name-only", "--no-renames", mergeBase, ctx.head], cwd),
        );
        declared = declaredSlugs(
          await git(["log", "--format=%B", `${mergeBase}..${ctx.head}`], cwd),
        );
      } catch {
        if (knowledge.drift_check === "block") {
          return { ok: false, message: `cannot resolve base ${ctx.base} against ${ctx.head}` };
        }
        return { ok: true };
      }

      const root = knowledge.root
        .replace(/\\/g, "/")
        .replace(/^(\.\/)+/, "")
        .replace(/\/+$/, "");
      const changedSet = new Set(changed);
      const docUpdated = loadFeatureDocs(cwd, knowledge.root)
        .filter((doc) => changedSet.has(`${root}/${doc.path}`))
        .map((doc) => doc.id);

      const result = checkDrift({
        repoRoot: cwd,
        workItemId: "",
        changedFiles: changed,
        severity: "block",
        root: knowledge.root,
        declaredUnchanged: [...declared, ...docUpdated],
      });
      if (result.findings.length === 0) return { ok: true };

      const reports = result.findings.map(
        (finding) =>
          `feature ${finding.feature}: anchored files changed without a feature doc update or Feature-Unchanged: declaration: ${finding.files.join(", ")}`,
      );
      if (knowledge.drift_check === "block") return { ok: false, message: reports.join("; ") };
      for (const report of reports) warn(report);
      return { ok: true };
    },
  };
}
