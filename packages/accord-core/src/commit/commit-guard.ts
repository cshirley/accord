import { isTestFilePath } from "../orchestration/review-paths.js";
import { emitStackEvent } from "../telemetry/stack-events.js";
import { type AccordTrailer, type ValidateContext, validateTrailer } from "./commit-grammar.js";

export interface GuardResult {
  kept: string[];
  rejected: string[];
  rule?: string;
  respawn?: string;
}

export interface TrailerGuardResult {
  ok: boolean;
  rule?: string;
  errors: string[];
}

type Scope = "reviews" | "state" | "evidence";

interface PathRule {
  rule: string;
  scopes: Scope[];
}

const PATH_RULES: Record<string, PathRule> = {
  "review-test": { rule: "reviews-only", scopes: ["reviews", "state"] },
  "review-code": { rule: "reviews-only", scopes: ["reviews", "state"] },
  "review-security": { rule: "reviews-only", scopes: ["reviews", "state"] },
  "phase-verify-task": { rule: "state-only", scopes: ["state"] },
  state: { rule: "state-only", scopes: ["state"] },
  evidence: { rule: "evidence-only", scopes: ["evidence", "state"] },
};

const TEST_DIR_RE = /(?:^|\/)(?:test|__tests__|tests|spec)\//;

function inScope(path: string, workItemId: string, scopes: Scope[]): boolean {
  if (path.split("/").includes("..")) return false;
  return scopes.some((scope) => path.startsWith(`docs/dev/${workItemId}/${scope}/`));
}

function globToRegExp(glob: string): RegExp {
  let source = "";
  let braceDepth = 0;
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index] as string;
    if (char === "*") {
      if (glob[index + 1] === "*") {
        const slash = glob[index + 2] === "/";
        source += slash ? "(?:.*/)?" : ".*";
        index += slash ? 2 : 1;
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else if (char === "{") {
      braceDepth += 1;
      source += "(?:";
    } else if (char === "}" && braceDepth > 0) {
      braceDepth -= 1;
      source += ")";
    } else if (char === "," && braceDepth > 0) {
      source += "|";
    } else {
      source += char.replace(/[.+^$()|[\]\\{}]/g, "\\$&");
    }
  }
  return new RegExp(`^${source}$`);
}

function isTestPath(path: string, pattern: string): boolean {
  if (TEST_DIR_RE.test(path)) return true;
  if (pattern.trim() === "") return isTestFilePath(path);
  const matcher = globToRegExp(pattern.trim());
  const target = pattern.includes("/") ? path : (path.split("/").pop() as string);
  return matcher.test(target);
}

function reject(workItemId: string, ref: string, rule: string, path: string): void {
  emitStackEvent("stack.guard.rejected", { work_item_id: workItemId, ref, rule, path });
}

export function guardStagedPaths(
  commitType: string,
  workItemId: string,
  paths: string[],
  testFilePattern: string,
): GuardResult {
  let rule: string;
  let allowed: (path: string) => boolean;
  let respawn: string | undefined;

  if (commitType === "phase-test") return { kept: [...paths], rejected: [] };
  if (commitType === "phase-code") {
    rule = "code-touches-test";
    respawn = "phase-test";
    allowed = (path) => !isTestPath(path, testFilePattern);
  } else {
    const pathRule = PATH_RULES[commitType];
    if (!pathRule) throw new Error(`unknown commit type: ${commitType}`);
    rule = pathRule.rule;
    allowed = (path) => inScope(path, workItemId, pathRule.scopes);
  }

  const kept: string[] = [];
  const rejected: string[] = [];
  for (const path of paths) {
    if (allowed(path)) kept.push(path);
    else rejected.push(path);
  }
  for (const path of rejected) reject(workItemId, commitType, rule, path);
  if (rejected.length === 0) return { kept, rejected };
  return respawn ? { kept, rejected, rule, respawn } : { kept, rejected, rule };
}

export function guardTrailer(
  workItemId: string,
  trailer: AccordTrailer,
  ctx?: ValidateContext,
): TrailerGuardResult {
  const result = validateTrailer(trailer, ctx);
  if (result.ok) return { ok: true, errors: [] };
  const onlyCounts = result.errors.every((error) => error.includes("does not equal"));
  const rule = onlyCounts ? "trailer-counts" : "trailer-invalid";
  const ref = typeof trailer.ref === "string" && trailer.ref !== "" ? trailer.ref : "unknown";
  reject(workItemId, ref, rule, "");
  return { ok: false, rule, errors: result.errors };
}
