import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import prReviewContextDef, { toContextParams } from "../src/defs/pr-review-context.js";
import {
  defaultPrReviewModels,
  parsePaginatedArray,
  parsePrNumber,
  resolvePrReviewModels,
  reviewAgentProvider,
  rightLinesOfPatch,
  runPrReviewPost,
  runPrReviewReport,
} from "../src/lib/review/pr.js";

describe("parsePrNumber", () => {
  test.each([
    ["449", 449],
    ["#449", 449],
    ["https://github.com/o/r/pull/449", 449],
    ["https://github.com/o/r/pull/449/files", 449],
  ])("%s", (input, want) => expect(parsePrNumber(input)).toBe(want));
  test.each(["", "abc", "0", "-3", "1.5"])("rejects %p", (input) =>
    expect(parsePrNumber(input)).toBeNull(),
  );
});

describe("runPrReviewReport", () => {
  const packet = (files: string[]) =>
    `x\n\`\`\`json\n${JSON.stringify({ verdict: "issues", findings: [{ severity: "warning", message: "boom", file: "a.ts", line: 3 }], files_reviewed: files })}\n\`\`\``;

  async function withContext(run: (dir: string) => Promise<void>) {
    const dir = await mkdtemp(join(tmpdir(), "pr-report-"));
    try {
      await writeFile(
        join(dir, "context.json"),
        JSON.stringify({
          pr: { number: 1, title: "t", baseRefName: "base", headRefOid: "sha" },
          plan: {
            shards: [{ index: 1, files: ["a.ts", "b.ts"], bytes: 1 }],
            skipped: ["lock"],
            oversized: [],
          },
          taskFiles: [
            { shard: 1, agent: "review-code", files: ["a.ts", "b.ts"] },
            { shard: 1, agent: "review-security", files: ["a.ts", "b.ts"] },
          ],
        }),
      );
      await run(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  test("merges, reports coverage and writes report.json", async () => {
    await withContext(async (dir) => {
      const results = [
        { shard: 1, agent: "review-code", exitCode: 0, output: packet(["a.ts", "b.ts"]) },
        { shard: 1, agent: "review-security", exitCode: 0, output: packet(["a.ts"]) },
      ];
      const out = await runPrReviewReport({ temp_dir: dir, results_json: JSON.stringify(results) });
      expect(out.isError).toBeUndefined();
      expect(out.text).toContain("### Coverage");
      expect(out.text).toContain("shard 1 review-security: did not report b.ts");
      const saved = JSON.parse(await readFile(join(dir, "report.json"), "utf8"));
      expect(saved.findings.length).toBeGreaterThan(0);
    });
  });

  test("a task that never ran is a failure, not silence", async () => {
    await withContext(async (dir) => {
      const results = [
        { shard: 1, agent: "review-code", exitCode: 0, output: packet(["a.ts", "b.ts"]) },
      ];
      const out = await runPrReviewReport({ temp_dir: dir, results_json: JSON.stringify(results) });
      expect(out.text).toContain("Agent failures");
      expect(out.text).toContain("task was not run");
    });
  });

  test("a repeated run that never ran is a failure for that run only", async () => {
    await withContext(async (dir) => {
      const ctx = JSON.parse(await readFile(join(dir, "context.json"), "utf8"));
      ctx.taskFiles = ctx.taskFiles.flatMap((t: object) => [1, 2].map((run) => ({ ...t, run })));
      await writeFile(join(dir, "context.json"), JSON.stringify(ctx));
      const results = ctx.taskFiles
        .filter(
          (t: { run: number; agent: string }) => !(t.run === 2 && t.agent === "review-security"),
        )
        .map((t: { run: number; agent: string }) => ({
          shard: 1,
          run: t.run,
          agent: t.agent,
          exitCode: 0,
          output: packet(["a.ts", "b.ts"]),
        }));
      const out = await runPrReviewReport({ temp_dir: dir, results_json: JSON.stringify(results) });
      expect(out.text).toContain("task was not run");
      expect(out.text).toContain("2 runs:");
    });
  });

  test("errors on a missing context or bad JSON", async () => {
    expect(
      (await runPrReviewReport({ temp_dir: "/nonexistent", results_json: "[]" })).isError,
    ).toBe(true);
    await withContext(async (dir) => {
      expect((await runPrReviewReport({ temp_dir: dir, results_json: "nope" })).isError).toBe(true);
    });
  });
});

describe("runPrReviewPost", () => {
  const diff = "diff --git a/f.ts b/f.ts\n--- a/f.ts\n+++ b/f.ts\n@@ -1,2 +1,3 @@\n a\n+b\n c\n";

  async function setup(run: (dir: string) => Promise<void>) {
    const dir = await mkdtemp(join(tmpdir(), "pr-post-"));
    try {
      await writeFile(
        join(dir, "context.json"),
        JSON.stringify({
          pr: { number: 9, url: "u", baseRefName: "base", headRefOid: "sha1" },
          repo_root: "/repo",
        }),
      );
      await writeFile(
        join(dir, "report.json"),
        JSON.stringify({
          findings: [
            { severity: "warning", message: "inline", file: "f.ts", line: 2, agent: "review-code" },
          ],
        }),
      );
      await writeFile(join(dir, "pr.diff"), diff);
      await run(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  const fakeGh =
    (live: { headRefOid: string; state: string }, calls: string[][], createdState = "PENDING") =>
    async (args: string[]) => {
      calls.push(args);
      return args[0] === "pr"
        ? JSON.stringify(live)
        : JSON.stringify({ id: 5, state: createdState, html_url: "https://x/review/5" });
    };

  test("dry run builds the payload and never calls GitHub", async () => {
    await setup(async (dir) => {
      const calls: string[][] = [];
      const out = await runPrReviewPost(
        { temp_dir: dir, summary: "S", dry_run: true },
        { gh: fakeGh({ headRefOid: "sha1", state: "OPEN" }, calls) },
      );
      expect(calls).toHaveLength(0);
      const payload = (out.details as { payload: { comments: unknown[]; event?: string } }).payload;
      expect(payload.comments).toHaveLength(1);
      expect("event" in payload).toBe(false);
    });
  });

  test("creates a pending review with no event", async () => {
    await setup(async (dir) => {
      const calls: string[][] = [];
      const out = await runPrReviewPost(
        { temp_dir: dir, summary: "S" },
        { gh: fakeGh({ headRefOid: "sha1", state: "OPEN" }, calls) },
      );
      expect(out.isError).toBeUndefined();
      expect(out.text).toContain("Pending review created");
      const sent = JSON.parse(await readFile(join(dir, "review.json"), "utf8"));
      expect("event" in sent).toBe(false);
      expect(sent.commit_id).toBe("sha1");
      expect(calls.some((c) => c[0] === "api" && c.includes("POST"))).toBe(true);
    });
  });

  test("refuses when the head moved, posts nothing", async () => {
    await setup(async (dir) => {
      const calls: string[][] = [];
      const out = await runPrReviewPost(
        { temp_dir: dir, summary: "S" },
        { gh: fakeGh({ headRefOid: "sha2", state: "OPEN" }, calls) },
      );
      expect(out.isError).toBe(true);
      expect(out.text).toContain("head moved");
      expect(calls.some((c) => c[0] === "api")).toBe(false);
    });
  });

  test("refuses a closed PR, an empty summary and a non-PENDING answer", async () => {
    await setup(async (dir) => {
      const closed = await runPrReviewPost(
        { temp_dir: dir, summary: "S" },
        { gh: fakeGh({ headRefOid: "sha1", state: "MERGED" }, []) },
      );
      expect(closed.isError).toBe(true);
      const empty = await runPrReviewPost(
        { temp_dir: dir, summary: "  " },
        { gh: fakeGh({ headRefOid: "sha1", state: "OPEN" }, []) },
      );
      expect(empty.isError).toBe(true);
      const submitted = await runPrReviewPost(
        { temp_dir: dir, summary: "S" },
        { gh: fakeGh({ headRefOid: "sha1", state: "OPEN" }, [], "COMMENTED") },
      );
      expect(submitted.isError).toBe(true);
      expect(submitted.text).toContain("Unexpected review state");
    });
  });

  test("a server error after GitHub created the review is recognised as success, not a failure", async () => {
    await setup(async (dir) => {
      let postedBody = "";
      const gh = async (args: string[]) => {
        if (args[0] === "pr") return JSON.stringify({ headRefOid: "sha1", state: "OPEN" });
        if (args.includes("POST")) {
          postedBody = JSON.parse(
            await readFile(args[args.indexOf("--input") + 1] as string, "utf8"),
          ).body;
          throw new Error("HTTP 502");
        }
        return JSON.stringify([
          { id: 1, state: "COMMENTED", body: postedBody },
          { id: 9, state: "PENDING", body: postedBody, html_url: "https://x/review/9" },
        ]);
      };
      const out = await runPrReviewPost({ temp_dir: dir, summary: "S" }, { gh });
      expect(out.isError).toBeUndefined();
      expect(out.text).toContain("Pending review created");
    });
  });

  test("merges extra findings and reports GitHub refusals", async () => {
    await setup(async (dir) => {
      const dry = await runPrReviewPost({
        temp_dir: dir,
        summary: "S",
        dry_run: true,
        extra_findings_json: JSON.stringify([
          { severity: "suggestion", message: "cross", agent: "review-code" },
        ]),
      });
      expect((dry.details as { unanchored: unknown[] }).unanchored).toHaveLength(1);
      const refused = await runPrReviewPost(
        { temp_dir: dir, summary: "S" },
        {
          gh: async (a) => {
            if (a[0] === "api") throw new Error("422 pending review exists");
            return JSON.stringify({ headRefOid: "sha1", state: "OPEN" });
          },
        },
      );
      expect(refused.isError).toBe(true);
      expect(refused.text).toContain("422");
    });
  });
});

describe("parsePaginatedArray", () => {
  test("joins the pages gh prints back to back", () => {
    expect(parsePaginatedArray<number>("[1,2]\n[3]")).toEqual([1, 2, 3]);
    expect(parsePaginatedArray<number>("[1]")).toEqual([1]);
  });
});

describe("rightLinesOfPatch", () => {
  test("counts context and added lines on the right side only", () => {
    const patch = "@@ -1,3 +1,4 @@\n a\n-old\n+new1\n+new2\n c\n\\ No newline at end of file";
    expect([...rightLinesOfPatch(patch)]).toEqual([1, 2, 3, 4]);
  });
});

describe("runPrReviewPost comment-batches", () => {
  const many = Array.from({ length: 5 }, (_, i) => `+l${String(i)}`).join("\n");
  const diff = `diff --git a/f.ts b/f.ts\n--- a/f.ts\n+++ b/f.ts\n@@ -0,0 +1,5 @@\n${many}\n`;
  const patch = `@@ -0,0 +1,5 @@\n${many}`;

  async function setup(run: (dir: string) => Promise<void>) {
    const dir = await mkdtemp(join(tmpdir(), "pr-batch-"));
    try {
      await writeFile(
        join(dir, "context.json"),
        JSON.stringify({
          pr: { number: 9, url: "u", baseRefName: "base", headRefOid: "sha1" },
          repo_root: "/repo",
        }),
      );
      await writeFile(
        join(dir, "report.json"),
        JSON.stringify({
          findings: Array.from({ length: 5 }, (_, i) => ({
            severity: "warning",
            message: `f${String(i)}`,
            file: "f.ts",
            line: i + 1,
            agent: "review-code",
          })),
        }),
      );
      await writeFile(join(dir, "pr.diff"), diff);
      await run(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  const noSleep = async () => {};
  const base = (posts: string[], failOn?: (n: number, body: string) => Error | null) => {
    let n = 0;
    return async (args: string[]) => {
      if (args[0] === "pr") return JSON.stringify({ headRefOid: "sha1", state: "OPEN" });
      if (args.includes("--paginate") && args.some((a) => a.endsWith("/files")))
        return JSON.stringify([{ filename: "f.ts", patch }]);
      if (args.includes("POST")) {
        n += 1;
        const sent = JSON.parse(
          await readFile(args[args.indexOf("--input") + 1] as string, "utf8"),
        );
        const err = failOn?.(n, sent.body);
        if (err) throw err;
        expect(sent.event).toBe("COMMENT");
        posts.push(`${String(sent.comments.length)}:${sent.body.slice(0, 30)}`);
        return JSON.stringify({ id: 100 + n });
      }
      return JSON.stringify([]);
    };
  };

  test("posts COMMENT reviews in batches, marker on each body", async () => {
    await setup(async (dir) => {
      const posts: string[] = [];
      const out = await runPrReviewPost(
        { temp_dir: dir, summary: "S", submit: "comment-batches", batch_size: 2 },
        { gh: base(posts), sleep: noSleep },
      );
      expect(out.isError).toBeUndefined();
      expect(posts.map((p) => p.split(":")[0])).toEqual(["2", "2", "1"]);
      expect(out.text).toContain("3 COMMENT review(s) with 5 inline");
    });
  });

  test("caps the batch size", async () => {
    await setup(async (dir) => {
      const posts: string[] = [];
      await runPrReviewPost(
        { temp_dir: dir, summary: "S", submit: "comment-batches", batch_size: 999 },
        { gh: base(posts), sleep: noSleep },
      );
      expect(posts).toHaveLength(1);
    });
  });

  test("a rate limit stops the run and says when to resume", async () => {
    await setup(async (dir) => {
      const posts: string[] = [];
      const out = await runPrReviewPost(
        { temp_dir: dir, summary: "S", submit: "comment-batches", batch_size: 2 },
        {
          gh: base(posts, (n) =>
            n === 2 ? new Error("You have exceeded a secondary rate limit") : null,
          ),
          sleep: noSleep,
        },
      );
      expect(out.isError).toBe(true);
      expect(out.text).toContain("resume_from=2");
      expect(out.text).toContain("20 minutes");
      expect(posts).toHaveLength(1);
    });
  });

  test("a 5xx after the review was created is found by its marker, not retried", async () => {
    await setup(async (dir) => {
      const sent: string[] = [];
      const gh = async (args: string[]) => {
        if (args[0] === "pr") return JSON.stringify({ headRefOid: "sha1", state: "OPEN" });
        if (args.includes("--paginate") && args.some((a) => a.endsWith("/files")))
          return JSON.stringify([{ filename: "f.ts", patch }]);
        if (args.includes("POST")) {
          sent.push(
            JSON.parse(await readFile(args[args.indexOf("--input") + 1] as string, "utf8")).body,
          );
          throw new Error("HTTP 502");
        }
        return JSON.stringify([
          { id: 7, state: "COMMENTED", body: `x ${sent[sent.length - 1] ?? ""}` },
        ]);
      };
      const out = await runPrReviewPost(
        { temp_dir: dir, summary: "S", submit: "comment-batches", batch_size: 25 },
        { gh, sleep: noSleep },
      );
      expect(out.isError).toBeUndefined();
      expect(sent).toHaveLength(1);
    });
  });

  test("resume_from skips comments already posted", async () => {
    await setup(async (dir) => {
      const posts: string[] = [];
      const gh = base(posts);
      const out = await runPrReviewPost(
        { temp_dir: dir, summary: "S", submit: "comment-batches", batch_size: 2, resume_from: 4 },
        { gh, sleep: noSleep },
      );
      expect(out.isError).toBeUndefined();
      expect(posts.map((p) => p.split(":")[0])).toEqual(["1"]);
    });
  });
});

describe("resolvePrReviewModels", () => {
  test("explicit models win, trimmed and capped at 3", () => {
    expect(
      resolvePrReviewModels({ models: [" a ", "", "b", "c", "d"], runs: 1 }, "github-copilot"),
    ).toEqual(["a", "b", "c"]);
  });
  test("an explicit runs means the same model repeated, so no models", () => {
    expect(resolvePrReviewModels({ runs: 2 }, "github-copilot")).toBeUndefined();
  });
  test("by default: sonnet then opus on a known provider, nothing elsewhere", () => {
    expect(resolvePrReviewModels({}, "github-copilot")).toEqual([
      "claude-sonnet-5.5",
      "claude-opus-5.5",
    ]);
    expect(defaultPrReviewModels("anthropic")).toEqual(["claude-sonnet-5-5", "claude-opus-5-5"]);
    expect(resolvePrReviewModels({}, "openrouter")).toBeUndefined();
    expect(resolvePrReviewModels({}, "something-else")).toBeUndefined();
  });
});

describe("runPrReviewReport with models", () => {
  test("takes each result's model from context.json, so the caller need not pass it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pr-models-"));
    try {
      await writeFile(
        join(dir, "context.json"),
        JSON.stringify({
          pr: { number: 1, title: "t", baseRefName: "base", headRefOid: "sha" },
          plan: { shards: [{ index: 1, files: ["a.ts"], bytes: 1 }], skipped: [], oversized: [] },
          runs: 2,
          taskFiles: [
            { shard: 1, run: 1, model: "claude-sonnet-5.5", agent: "review-code", files: ["a.ts"] },
            { shard: 1, run: 2, model: "claude-opus-5.5", agent: "review-code", files: ["a.ts"] },
          ],
        }),
      );
      const out = (line: number) =>
        `x\n\`\`\`json\n${JSON.stringify({ verdict: "issues", findings: [{ severity: "warning", message: "m", file: "a.ts", line }], files_reviewed: ["a.ts"] })}\n\`\`\``;
      const results = [
        { shard: 1, run: 1, agent: "review-code", exitCode: 0, output: out(2) },
        { shard: 1, run: 2, agent: "review-code", exitCode: 0, output: out(3) },
      ];
      const res = await runPrReviewReport({ temp_dir: dir, results_json: JSON.stringify(results) });
      expect(res.text).toContain("Models: claude-opus-5.5, claude-sonnet-5.5.");
      const saved = JSON.parse(await readFile(join(dir, "report.json"), "utf8"));
      expect(saved.findings[0].models).toEqual(["claude-opus-5.5", "claude-sonnet-5.5"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("reviewAgentProvider", () => {
  test("returns a provider name, from the review profile or the environment", () => {
    const provider = reviewAgentProvider();
    expect(provider === undefined || typeof provider === "string").toBe(true);
  });
});

describe("pr_review_context parameters", () => {
  test("every declared parameter is forwarded to the lib", () => {
    const declared = Object.keys(prReviewContextDef.params).filter((k) => k !== "pr");
    const given = {
      pr: "449",
      max_shards: 3,
      budget_kb: 50,
      single_shard_max_files: 10,
      runs: 3,
      models: ["a", "b"],
      lens: false,
      worktree: false,
    };
    const forwarded = Object.keys(toContextParams(given, 449)).filter((k) => k !== "pr");
    expect(forwarded.sort()).toEqual(declared.sort());
    expect(toContextParams(given, 449)).toMatchObject({
      pr: 449,
      models: ["a", "b"],
      lens: false,
      runs: 3,
    });
  });

  test("omitted parameters stay omitted, so the lib defaults apply", () => {
    expect(toContextParams({ pr: "449" }, 449)).toEqual({ pr: 449 });
  });
});
