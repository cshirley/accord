/**
 * gh_pr_context + gh_pr_submit implementations
 */

import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import {
  extractTicket,
  findSpecFiles,
  gh,
  git,
  gitRoot,
  truncateLines,
  withTempFile,
} from "../git.js";

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

export function formatPrContext(d: PrContextData): string {
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

export async function runGhPrContext(
  cwd: string,
  signal: AbortSignal | undefined,
  onUpdate: ((partial: AgentToolResult<unknown>) => void) | undefined,
): Promise<PrContextData> {
  const root = await gitRoot(cwd, signal);

  onUpdate?.({
    content: [{ type: "text", text: "Gathering PR context..." }],
    details: { progress: 10 },
  });

  let ghAuth = true;
  try {
    await gh(["auth", "status"], root, signal);
  } catch {
    ghAuth = false;
  }

  const branch = (await git(["branch", "--show-current"], root, signal)).trim();
  const ticket = extractTicket(branch);

  const [existingPrRaw, commitsRaw, diffStatRaw, specFiles] = await Promise.all([
    ghAuth
      ? gh(["pr", "view", "--json", "number,url,title,state"], root, signal).catch(() => null)
      : Promise.resolve(null),
    git(["log", "origin/HEAD..HEAD", "--oneline"], root, signal).catch(() => ""),
    git(["diff", "origin/HEAD...HEAD", "--stat"], root, signal).catch(() => ""),
    findSpecFiles(root, ticket, branch),
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

  return {
    branch,
    ticket,
    existingPr,
    commits: commitsRaw.trim(),
    diffStat: diffStatRaw.trim(),
    spec: specFiles.spec ?? null,
    verify: specFiles.verify ?? null,
    ghAuth,
  };
}

export async function runGhPrSubmit(
  cwd: string,
  params: { title?: string; body?: string },
  signal: AbortSignal | undefined,
  onUpdate: ((partial: AgentToolResult<unknown>) => void) | undefined,
) {
  const root = await gitRoot(cwd, signal);
  const { title, body } = params;

  onUpdate?.({
    content: [{ type: "text", text: "Pushing..." }],
    details: { progress: 20 },
  });

  try {
    await git(["push", "--set-upstream", "origin", "HEAD"], root, signal);
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

  const branch = (await git(["branch", "--show-current"], root, signal)).trim();

  if (!title) {
    let prInfo = "";
    try {
      const raw = await gh(["pr", "view", "--json", "number,url"], root, signal);
      const pr = JSON.parse(raw);
      prInfo = `\nPR #${pr.number} updated: ${pr.url}`;
    } catch {
      /* no existing PR */
    }
    return {
      text: `Pushed ${branch}.${prInfo}`,
      details: { action: "updated", branch },
    };
  }

  onUpdate?.({
    content: [{ type: "text", text: "Creating PR..." }],
    details: { progress: 60 },
  });

  const createOutput = await withTempFile(body ?? "", (bodyFile) =>
    gh(["pr", "create", "--title", title, "--body-file", bodyFile], root, signal),
  );
  const url = createOutput.trim();

  let number: number | undefined;
  try {
    const raw = await gh(["pr", "view", "--json", "number"], root, signal);
    number = JSON.parse(raw).number;
  } catch {
    /* ok */
  }

  return {
    text: `Created PR${number ? ` #${number}` : ""}: ${url}`,
    details: { action: "created", url, number, branch },
  };
}

