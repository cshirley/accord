/**
 * git_review_context implementation
 */

import { loadDevHarnessConfig } from "@clive.shirley/accord-core/config/index.js";
import {
  isStandaloneReviewTestFile,
  prepareStandaloneReviewContext,
  resolveStandaloneReviewTestCommand,
} from "@clive.shirley/accord-core/review/standalone.js";
import { gitRoot } from "../git.js";

export function formatReviewContext(d: {
  source: string;
  file_list: string[];
  diff_path: string;
  temp_dir: string;
  excerpt: string;
  test_command: string | null;
  has_test_files: boolean;
}): string {
  const lines: string[] = [
    `Source: ${d.source}`,
    `Files (${String(d.file_list.length)}): ${d.file_list.join(", ") || "(none)"}`,
    `Diff file: ${d.diff_path}`,
    `Temp dir (delete when review finishes): ${d.temp_dir}`,
  ];
  if (d.has_test_files) {
    lines.push(
      d.test_command
        ? `Test command: ${d.test_command}`
        : "Test command: (not configured — set AGENTS.md test.command or package.json scripts.test)",
    );
  }
  lines.push("", "Excerpt (orchestrator only — reviewers read diff file):", d.excerpt);
  return lines.join("\n");
}

export async function runGitReviewContext(cwd: string) {
  const root = await gitRoot(cwd, undefined);

  const prepared = await prepareStandaloneReviewContext(root);
  if (!prepared.ok) {
    return {
      text: prepared.error,
      details: { empty: true, error: prepared.error },
    };
  }

  const devConfig = loadDevHarnessConfig(root);
  const test_command = await resolveStandaloneReviewTestCommand(root, devConfig);
  const has_test_files = prepared.value.file_list.some(isStandaloneReviewTestFile);

  const details = {
    source: prepared.value.source,
    file_list: prepared.value.file_list,
    diff_path: prepared.value.diff_path,
    temp_dir: prepared.value.temp_dir,
    excerpt: prepared.value.excerpt,
    test_command,
    has_test_files,
  };

  return {
    text: formatReviewContext(details),
    details,
  };
}

