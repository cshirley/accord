import { git } from "../git/helpers.js";

export interface ActualLines {
  act_prod_lines: number;
  act_test_lines: number;
}

export interface MeasureLinesOptions {
  /** Glob of test files, e.g. `**\/*.test.ts`. */
  testPattern?: string;
}

const DEFAULT_TEST_PATTERN = "**/*.test.ts";
const STATE_PATH_RE = /^(?:docs\/dev\/[^/]+\/(?:state|reviews|evidence)|\.tasks)\//;
const LOCK_NAMES = new Set([
  "bun.lock",
  "bun.lockb",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "Cargo.lock",
  "Gemfile.lock",
  "poetry.lock",
  "composer.lock",
  "go.sum",
]);

function globToRegExp(glob: string): RegExp {
  let source = "";
  let index = 0;
  while (index < glob.length) {
    const char = glob[index] as string;
    if (char === "*") {
      if (glob[index + 1] === "*") {
        if (glob[index + 2] === "/") {
          source += "(?:.*/)?";
          index += 3;
        } else {
          source += ".*";
          index += 2;
        }
      } else {
        source += "[^/]*";
        index += 1;
      }
    } else if (char === "?") {
      source += "[^/]";
      index += 1;
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      index += 1;
    }
  }
  return new RegExp(`^${source}$`);
}

function isExcluded(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return (
    STATE_PATH_RE.test(path) ||
    LOCK_NAMES.has(name) ||
    name.endsWith(".lock") ||
    /\.generated\./.test(name)
  );
}

/** Single definition of actual PR size: net `git diff --numstat` of production and test lines. */
export async function measureActualLines(
  cwd: string,
  base: string,
  head: string,
  options: MeasureLinesOptions = {},
): Promise<ActualLines> {
  const result: ActualLines = { act_prod_lines: 0, act_test_lines: 0 };
  if (base === head) return result;
  const isTest = globToRegExp(options.testPattern ?? DEFAULT_TEST_PATTERN);
  const out = await git(["diff", "--numstat", "--no-renames", "-z", base, head], cwd);
  for (const record of out.split("\0")) {
    if (record === "") continue;
    const [added, deleted, ...rest] = record.split("\t");
    const path = rest.join("\t");
    if (path === "" || isExcluded(path)) continue;
    const changed = (Number(added) || 0) + (Number(deleted) || 0);
    if (isTest.test(path)) result.act_test_lines += changed;
    else result.act_prod_lines += changed;
  }
  return result;
}
