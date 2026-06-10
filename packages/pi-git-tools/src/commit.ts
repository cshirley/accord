/**
 * Commit tools — git_commit_context + git_commit_execute
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { assembleSmartDiff } from "./diff.js";
import {
  type ArtifactInfo,
  COMMIT_TYPE_PREFIXES,
  extractStatusPaths,
  extractTicket,
  git,
  gitRoot,
  isDevArtifact,
  isSecretFile,
  readArtifacts,
  validateCommitMessage,
  withTempFile,
} from "./git.js";

type CommitTypePrefix = (typeof COMMIT_TYPE_PREFIXES)[number];
type TicketSource = "branch" | "artifact" | "inferred" | "none";

interface TicketSuggestion {
  value: CommitTypePrefix;
  reason: string;
  score: number;
}

function inferTicketSuggestions(
  paths: string[],
  diffStat: string,
  diff: string,
  branch: string,
): TicketSuggestion[] {
  const haystack = `${branch}\n${paths.join("\n")}\n${diffStat}\n${diff}`.toLowerCase();
  const suggestions = new Map<CommitTypePrefix, TicketSuggestion>();
  const add = (value: CommitTypePrefix, score: number, reason: string) => {
    const existing = suggestions.get(value);
    if (!existing || score > existing.score) {
      suggestions.set(value, { value, reason, score });
    }
  };

  const hasPath = (pattern: RegExp) => paths.some((p) => pattern.test(p));
  const allPaths = (pattern: RegExp) => paths.length > 0 && paths.every((p) => pattern.test(p));
  const codeChanged = hasPath(
    /\.(ts|tsx|js|jsx|mjs|cjs|py|rb|go|rs|java|kt|swift|lua|sh|zsh|bash)$/,
  );
  const hasAddedLines = diff
    .split("\n")
    .some((line) => line.startsWith("+") && !line.startsWith("+++"));

  if (/\b(fix|bug|regression|broken|crash|error|fail|failure|guard|handle)\b/.test(haystack)) {
    add("FIX", 90, "Diff or branch language points to corrective behavior");
  }
  if (
    /\b(add|adds|support|enable|introduce|infer|suggest|new)\b/.test(haystack) ||
    (codeChanged && hasAddedLines)
  ) {
    add("FEATURE", 80, "Source changes add or expand behavior");
  }
  if (
    hasPath(
      /(^|\/)(settings|config|configs|\.config)\b|(^|\/)(package|tsconfig|AGENTS|Brewfile)|\.(json|toml|ya?ml)$/,
    )
  ) {
    add("CONFIG", 70, "Configuration or tool settings changed");
  }
  if (hasPath(/(^|\/)(__tests__|test|tests|spec|specs)(\/|$)|\.(test|spec)\./)) {
    add("TEST", 70, "Test files changed");
  }
  if (allPaths(/(^|\/)(docs?|skills)(\/|$)|\.(md|mdx|txt)$/)) {
    add("DOCS", 75, "Only documentation-like files changed");
  } else if (hasPath(/(^|\/)(docs?|skills)(\/|$)|\.(md|mdx)$/)) {
    add("DOCS", 45, "Documentation changed alongside code");
  }
  if (/\b(refactor|rename|extract|cleanup|restructure|simplify)\b/.test(haystack)) {
    add("REFACTOR", 60, "Change language suggests restructuring without new behavior");
  }
  if (hasPath(/(^|\/)(lockfile|package-lock|pnpm-lock|yarn\.lock)$|(^|\/)scripts\//)) {
    add("CHORE", 50, "Maintenance or tooling files changed");
  }
  if (suggestions.size === 0) {
    add("CHORE", 10, "No stronger change type matched");
  }

  return [...suggestions.values()].sort(
    (a, b) =>
      b.score - a.score ||
      COMMIT_TYPE_PREFIXES.indexOf(a.value) - COMMIT_TYPE_PREFIXES.indexOf(b.value),
  );
}

function formatContext(d: {
  branch: string;
  ticket: string | null;
  ticketSource: TicketSource;
  ticketSuggestions: TicketSuggestion[];
  recentCommits: string;
  status: string;
  diffStat: string;
  diff: string;
  suppressed: string[];
  totalFiles: number;
  includedFiles: number;
  secretWarnings: string[];
  artifacts: ArtifactInfo[];
  suggestedFiles: string[];
  excludedFiles: string[];
}): string {
  const out: string[] = [];

  out.push(`Branch: ${d.branch}`);
  const ticketLabel =
    d.ticketSource === "inferred"
      ? `${d.ticket} (inferred replacement prefix)`
      : (d.ticket ?? "(not detected)");
  out.push(`Ticket: ${ticketLabel}`);
  if (d.ticketSource === "inferred" && d.ticketSuggestions.length) {
    out.push(
      `Ticket suggestions:\n${d.ticketSuggestions.map((s) => `- [${s.value}] ${s.reason}`).join("\n")}`,
    );
  }
  out.push(`\nLog:\n${d.recentCommits || "(none)"}`);
  out.push(`\nStatus:\n${d.status || "(clean)"}`);

  if (d.secretWarnings.length) out.push(`\n⚠ Secrets (excluded):\n${d.secretWarnings.join("\n")}`);

  if (d.artifacts.length) {
    const lines = d.artifacts.map((a) => {
      const meta = [a.title, a.phase && `phase:${a.phase}`].filter(Boolean).join(", ");
      return `- ${a.path}${meta ? ` (${meta})` : ""}`;
    });
    out.push(`\nArtifacts:\n${lines.join("\n")}`);
  }

  out.push(`\nStage:\n${d.suggestedFiles.join("\n") || "(none)"}`);

  if (d.excludedFiles.length) out.push(`\nExcluded:\n${d.excludedFiles.join("\n")}`);

  out.push(`\nDiffstat:\n${d.diffStat || "(no changes)"}`);

  if (d.suppressed.length)
    out.push(
      `\nSuppressed diffs (${d.suppressed.length} files — use \`read\` for details):\n${d.suppressed.map((s) => `  ${s}`).join("\n")}`,
    );

  out.push(`\nDiff (${d.includedFiles}/${d.totalFiles} files, -U1 context):\n${d.diff}`);

  return out.join("\n");
}

export function registerCommitTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "git_commit_context",
    label: "Git Commit Context",
    description:
      "Gather status, diff, diffstat, log, branch, secrets, and artifacts in one parallel call for commit drafting.",
    promptSnippet: "Gather git context (status/diff/log/branch/secrets/artifacts) in one call",
    parameters: Type.Object({}),

    async execute(_toolCallId, _params, signal, onUpdate, ctx) {
      const cwd = await gitRoot(ctx.cwd, signal);

      onUpdate?.({
        content: [{ type: "text", text: "Running git commands..." }],
        details: { progress: 10 },
      });

      // Parallel: metadata + smart diff assembly
      const [statusRaw, diffStat, logOutput, branchRaw, smartDiff] = await Promise.all([
        git(["status", "--porcelain"], cwd, signal),
        git(["diff", "--stat", "HEAD"], cwd, signal).catch(() =>
          Promise.all([
            git(["diff", "--stat"], cwd, signal),
            git(["diff", "--staged", "--stat"], cwd, signal),
          ]).then(([a, b]) => [a, b].filter(Boolean).join("\n")),
        ),
        git(["log", "--oneline", "-5"], cwd, signal).catch(() => ""),
        git(["branch", "--show-current"], cwd, signal),
        assembleSmartDiff(cwd, signal),
      ]);

      const branch = branchRaw.trim();
      const ticket = extractTicket(branch);

      const allPaths = extractStatusPaths(statusRaw);
      const secretFiles = allPaths.filter(isSecretFile);
      const artifactPaths = allPaths.filter(isDevArtifact);
      const safeFiles = allPaths.filter((p) => !isSecretFile(p));

      const artifacts = artifactPaths.length > 0 ? await readArtifacts(artifactPaths, cwd) : [];

      const artifactTicket = !ticket ? (artifacts.find((a) => a.ticket)?.ticket ?? null) : null;
      const resolvedTicket = ticket ?? artifactTicket;
      const ticketSuggestions =
        resolvedTicket || safeFiles.length === 0
          ? []
          : inferTicketSuggestions(safeFiles, diffStat.trim(), smartDiff.diff, branch);
      const inferredTicket = ticketSuggestions[0]?.value ?? null;
      const ticketSource: TicketSource = ticket
        ? "branch"
        : artifactTicket
          ? "artifact"
          : inferredTicket
            ? "inferred"
            : "none";

      const result = {
        branch,
        ticket: resolvedTicket ?? inferredTicket,
        ticketSource,
        ticketSuggestions,
        recentCommits: logOutput.trim(),
        status: statusRaw.trim(),
        diffStat: diffStat.trim(),
        diff: smartDiff.diff,
        suppressed: smartDiff.suppressed,
        totalFiles: smartDiff.totalFiles,
        includedFiles: smartDiff.includedFiles,
        secretWarnings: secretFiles.map((f) => `⚠ ${f}`),
        artifacts,
        suggestedFiles: safeFiles,
        excludedFiles: secretFiles,
      };

      return {
        content: [{ type: "text", text: formatContext(result) }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "git_commit_execute",
    label: "Git Commit Execute",
    description: "Stage files individually and commit. Returns hash and status.",
    promptSnippet: "Stage files and commit — returns hash and status",
    parameters: Type.Object({
      files: Type.Array(Type.String(), {
        description: "Files to stage",
      }),
      message: Type.String({ description: "Commit message" }),
    }),

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const cwd = await gitRoot(ctx.cwd, signal);
      const { files, message } = params;

      if (!files.length) throw new Error("No files to stage.");

      onUpdate?.({
        content: [
          {
            type: "text",
            text: `Staging ${files.length} file(s)...`,
          },
        ],
        details: { progress: 20 },
      });

      for (const file of files) {
        await git(["add", "--", file], cwd, signal);
      }

      const staged = await git(["diff", "--staged", "--stat"], cwd, signal);
      if (!staged.trim()) throw new Error("Nothing staged. Files may be unchanged.");

      onUpdate?.({
        content: [{ type: "text", text: "Committing..." }],
        details: { progress: 70 },
      });

      // Validate message format
      const warnings = validateCommitMessage(message);

      // Commit via temp file (avoids shell escaping issues with quotes/apostrophes)
      await withTempFile(message, (msgFile) => git(["commit", "-F", msgFile], cwd, signal));

      const hash = (await git(["rev-parse", "--short", "HEAD"], cwd, signal)).trim();
      const postStatus = (await git(["status"], cwd, signal)).trim();

      const warningText = warnings.length
        ? `\n\n⚠ Format warnings:\n${warnings.map((w) => `  ${w.field}: ${w.message}`).join("\n")}`
        : "";

      return {
        content: [
          {
            type: "text",
            text: `Committed ${hash}${warningText}\n\n${postStatus}`,
          },
        ],
        details: { commitHash: hash, postStatus, warnings },
      };
    },
  });
}
