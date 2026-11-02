import { execFile } from "node:child_process";
import type {
  EvidenceState,
  ResolveStackProviderOptions,
  StackPr,
  StackProvider,
  StackPrState,
} from "./provider.js";

const EVIDENCE_CONTEXT = "accord/evidence";
const PR_FIELDS = "number,url,state,headRefName,baseRefName";

interface RawPr {
  number: number;
  url: string;
  state: string;
  headRefName: string;
  baseRefName: string;
}

function run(command: "gh" | "git", args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { cwd, maxBuffer: 64 * 1024 * 1024, encoding: "utf8" },
      (error, stdout) => {
        if (error) {
          const label = command === "gh" ? args.slice(0, 2).join(" ") : args[0];
          reject(new Error(`${command} ${label} failed`));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function parseJson<T>(text: string, label: string): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`gh ${label} returned invalid JSON`);
  }
}

function mapState(state: string): StackPrState {
  const upper = state.toUpperCase();
  if (upper === "OPEN") return "open";
  if (upper === "MERGED") return "merged";
  return "closed";
}

function toStackPr(raw: RawPr): StackPr {
  return {
    number: raw.number,
    url: raw.url,
    state: mapState(raw.state),
    head: raw.headRefName,
    base: raw.baseRefName,
  };
}

export function createGhStackProvider(options?: ResolveStackProviderOptions): StackProvider {
  const cwd = options?.cwd;
  const gh = (args: string[]) => run("gh", args, cwd);
  const git = (args: string[]) => run("git", args, cwd);

  const listPrs: StackProvider["listPrs"] = async (input) => {
    const args = ["pr", "list", "--json", PR_FIELDS];
    if (input?.head) args.push("--head", input.head);
    if (input?.state) args.push("--state", input.state);
    args.push("--limit", "1000");
    const raw = parseJson<RawPr[]>(await gh(args), "pr list");
    return raw.map(toStackPr);
  };

  const readPaginated = async (path: string): Promise<{ id: number; body?: string }[]> => {
    const parsed = parseJson<unknown[]>(await gh(["api", "--paginate", "--slurp", path]), "api");
    return parsed.flat() as { id: number; body?: string }[];
  };

  return {
    listPrs,

    async createOrUpdatePr({ head, base, title, body }) {
      const existing = (await listPrs({ head, state: "open" })).find((pr) => pr.head === head);
      if (existing) {
        await gh(["pr", "edit", String(existing.number), "--title", title, "--body", body]);
        return { number: existing.number, url: existing.url };
      }
      const url = (
        await gh(["pr", "create", "--head", head, "--base", base, "--title", title, "--body", body])
      ).trim();
      const number = Number(/\/pull\/(\d+)/.exec(url)?.[1]);
      if (!Number.isInteger(number)) throw new Error("gh pr create returned no PR number");
      return { number, url };
    },

    async upsertStackMapComment({ pr, workItemId, body }) {
      const marker = `<!-- accord:stack-map ${workItemId} -->`;
      const comments = await readPaginated(`repos/{owner}/{repo}/issues/${pr}/comments`);
      const existing = comments.find((comment) => comment.body?.includes(marker));
      const bodyField = `body=${marker}\n${body}`;
      if (existing) {
        await gh([
          "api",
          "-X",
          "PATCH",
          `repos/{owner}/{repo}/issues/comments/${existing.id}`,
          "-f",
          bodyField,
        ]);
        return;
      }
      await gh([
        "api",
        "-X",
        "POST",
        `repos/{owner}/{repo}/issues/${pr}/comments`,
        "-f",
        bodyField,
      ]);
    },

    async setEvidenceStatus({ sha, state, description }) {
      const combined = parseJson<{ statuses?: { context: string; state: EvidenceState }[] }>(
        await gh(["api", `repos/{owner}/{repo}/commits/${sha}/status`]),
        "api",
      );
      const current = combined.statuses?.find((status) => status.context === EVIDENCE_CONTEXT);
      if (current && current.state !== "pending") return;
      const args = [
        "api",
        "-X",
        "POST",
        `repos/{owner}/{repo}/statuses/${sha}`,
        "-f",
        `context=${EVIDENCE_CONTEXT}`,
        "-f",
        `state=${state}`,
      ];
      if (description) args.push("-f", `description=${description}`);
      await gh(args);
    },

    async ensureBranch({ branch, base }) {
      const exists = await git(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).then(
        () => true,
        () => false,
      );
      if (exists) return;
      await git(["branch", branch, base]);
    },

    async pushBranch({ branch }) {
      await git(["push", "origin", `refs/heads/${branch}:refs/heads/${branch}`]);
    },

    async retarget(pr, base) {
      await gh(["pr", "edit", String(pr), "--base", base]);
    },
  };
}
