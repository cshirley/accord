/**
 * PR tools — gh_pr_context + gh_pr_submit
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";
import {
  extractTicket,
  findSpecFiles,
  gh,
  git,
  gitRoot,
  truncateLines,
  withTempFile,
} from "./git.js";

// ── Formatting ──────────────────────────────────────────────────────────────

interface PrContextData {
  branch: string;
  ticket: string | null;
  existingPr: { number: number; url: string; title: string; state: string } | null;
  commits: string;
  diffStat: string;
  spec: { path: string; content: string } | null;
  verify: { path: string; content: string } | null;
  ghAuth: boolean;
}

function formatPrContext(d: PrContextData): string {
  const out: string[] = [];

  out.push(`Branch: ${d.branch}`);
  out.push(`Ticket: ${d.ticket ?? "(not detected)"}`);
  out.push(`gh auth: ${d.ghAuth ? "✓" : "✗ — run `gh auth login`"}`);

  if (d.existingPr) {
    out.push(`\nExisting PR: #${d.existingPr.number} [${d.existingPr.state}]`);
    out.push(`  ${d.existingPr.title}`);
    out.push(`  ${d.existingPr.url}`);
  } else {
    out.push(`\nExisting PR: none — will create`);
  }

  out.push(`\nCommits (vs origin/HEAD):\n${d.commits || "(none)"}`);
  out.push(`\nFiles changed:\n${d.diffStat || "(none)"}`);

  if (d.spec) {
    const [content, truncated] = truncateLines(d.spec.content, 150);
    const tag = truncated ? " (truncated)" : "";
    out.push(`\nSpec${tag}: ${d.spec.path}\n${content}`);
  } else {
    out.push(`\nSpec: not found`);
  }

  if (d.verify) {
    const [content, truncated] = truncateLines(d.verify.content, 100);
    const tag = truncated ? " (truncated)" : "";
    out.push(`\nVerify report${tag}: ${d.verify.path}\n${content}`);
  } else {
    out.push(`\nVerify report: not found`);
  }

  return out.join("\n");
}

// ── Tool registration ───────────────────────────────────────────────────────

export function registerPrTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "gh_pr_context",
    label: "PR Context",
    description:
      "Gather PR context in one call: existing PR check, branch/ticket, commits, diffstat, spec doc, verify report. All commands run in parallel.",
    promptSnippet: "Gather PR context (existing PR/commits/diffstat/spec/verify) in one call",
    parameters: Type.Object({}),

    async execute(_toolCallId, _params, signal, onUpdate, ctx) {
      const cwd = await gitRoot(ctx.cwd, signal);

      onUpdate?.({
        content: [{ type: "text", text: "Gathering PR context..." }],
        details: { progress: 10 },
      });

      // Check gh auth first (fast fail)
      let ghAuth = true;
      try {
        await gh(["auth", "status"], cwd, signal);
      } catch {
        ghAuth = false;
      }

      // Get branch + ticket
      const branch = (await git(["branch", "--show-current"], cwd, signal)).trim();
      const ticket = extractTicket(branch);

      // Run remaining commands in parallel
      const [existingPrRaw, commitsRaw, diffStatRaw, specFiles] = await Promise.all([
        ghAuth
          ? gh(["pr", "view", "--json", "number,url,title,state"], cwd, signal).catch(() => null)
          : Promise.resolve(null),
        git(["log", "origin/HEAD..HEAD", "--oneline"], cwd, signal).catch(() => ""),
        git(["diff", "origin/HEAD...HEAD", "--stat"], cwd, signal).catch(() => ""),
        findSpecFiles(cwd, ticket, branch),
      ]);

      let existingPr: PrContextData["existingPr"] = null;
      if (existingPrRaw) {
        try {
          const parsed = JSON.parse(existingPrRaw);
          existingPr = {
            number: parsed.number,
            url: parsed.url,
            title: parsed.title,
            state: parsed.state,
          };
        } catch {
          /* malformed json */
        }
      }

      const result: PrContextData = {
        branch,
        ticket,
        existingPr,
        commits: commitsRaw.trim(),
        diffStat: diffStatRaw.trim(),
        spec: specFiles.spec ?? null,
        verify: specFiles.verify ?? null,
        ghAuth,
      };

      return {
        content: [{ type: "text", text: formatPrContext(result) }],
        details: result,
      };
    },
  });

  pi.registerTool({
    name: "gh_pr_submit",
    label: "PR Submit",
    description:
      "Push current branch and optionally create a PR. " +
      "Omit title/body for push-only (update existing PR). " +
      "Provide title+body to create a new PR.",
    promptSnippet: "Push branch + optionally create PR",
    parameters: Type.Object({
      title: Type.Optional(
        Type.String({
          description: "PR title (creates new PR if provided). Format: [TICKET-ID] summary",
        }),
      ),
      body: Type.Optional(Type.String({ description: "PR body markdown" })),
    }),

    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const cwd = await gitRoot(ctx.cwd, signal);
      const { title, body } = params;

      // Push
      onUpdate?.({
        content: [{ type: "text", text: "Pushing..." }],
        details: { progress: 20 },
      });

      try {
        await git(["push", "--set-upstream", "origin", "HEAD"], cwd, signal);
      } catch (err: unknown) {
        const msg =
          typeof err === "object" && err !== null && "stderr" in err
            ? String((err as { stderr?: unknown }).stderr)
            : err instanceof Error
              ? err.message
              : String(err);
        if (msg.includes("non-fast-forward") || msg.includes("rejected")) {
          throw new Error(`Push rejected (non-fast-forward). Pull or rebase first.\n${msg}`);
        }
        throw err;
      }

      const branch = (await git(["branch", "--show-current"], cwd, signal)).trim();

      // Push-only (update flow)
      if (!title) {
        // Check if PR exists for reporting
        let prInfo = "";
        try {
          const raw = await gh(["pr", "view", "--json", "number,url"], cwd, signal);
          const pr = JSON.parse(raw);
          prInfo = `\nPR #${pr.number} updated: ${pr.url}`;
        } catch {
          /* no existing PR */
        }
        return {
          content: [
            {
              type: "text",
              text: `Pushed ${branch}.${prInfo}`,
            },
          ],
          details: { action: "updated", branch },
        };
      }

      // Create flow — use --body-file to avoid shell escaping issues
      onUpdate?.({
        content: [{ type: "text", text: "Creating PR..." }],
        details: { progress: 60 },
      });

      const createOutput = await withTempFile(body ?? "", (bodyFile) =>
        gh(["pr", "create", "--title", title, "--body-file", bodyFile], cwd, signal),
      );
      const url = createOutput.trim();

      // Get PR number
      let number: number | undefined;
      try {
        const raw = await gh(["pr", "view", "--json", "number"], cwd, signal);
        number = JSON.parse(raw).number;
      } catch {
        /* ok */
      }

      return {
        content: [
          {
            type: "text",
            text: `Created PR${number ? ` #${number}` : ""}: ${url}`,
          },
        ],
        details: { action: "created", url, number, branch },
      };
    },
  });
}
