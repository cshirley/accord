/**
 * Review context tool — git_review_context
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { loadDevHarnessConfig } from "@clive.shirley/accord-core/config/index.js";
import {
  isStandaloneReviewTestFile,
  prepareStandaloneReviewContext,
  resolveStandaloneReviewTestCommand,
} from "@clive.shirley/accord-core/review/standalone.js";
import { Type } from "typebox";
import { gitRoot } from "./git.js";

function formatReviewContext(d: {
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

export function registerReviewTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "git_review_context",
    label: "Git Review Context",
    description:
      "Gather standalone review diff (staged → unstaged → origin/HEAD...HEAD), write full diff to a temp file, and return paths plus file list for parallel review agents.",
    promptSnippet: "Gather review diff ladder and write full diff to a temp file",
    parameters: Type.Object({}),

    async execute(_toolCallId, _params, signal, onUpdate, ctx) {
      const cwd = await gitRoot(ctx.cwd, signal);

      onUpdate?.({
        content: [{ type: "text", text: "Gathering review diff…" }],
        details: { progress: 20 },
      });

      const prepared = await prepareStandaloneReviewContext(cwd);
      if (!prepared.ok) {
        return {
          content: [{ type: "text", text: prepared.error }],
          details: { empty: true, error: prepared.error },
        };
      }

      const devConfig = loadDevHarnessConfig(cwd);
      const test_command = await resolveStandaloneReviewTestCommand(cwd, devConfig);
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
        content: [{ type: "text", text: formatReviewContext(details) }],
        details,
      };
    },
  });
}
