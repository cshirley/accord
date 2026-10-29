import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { validateReturn } from "@clive.shirley/accord-core/artifacts/validation.js";
import { devDispatch } from "@clive.shirley/accord-core/commands/dispatch.js";
import { tryCommitPhase } from "@clive.shirley/accord-core/commit/phase-commit.js";
import { formatSchemaBrief } from "@clive.shirley/accord-core/verification/runner.js";

const route = devDispatch("help");
if (route.type !== "known" || route.subcommand !== "help") {
  throw new Error("devDispatch help route failed");
}

const schemaBrief = formatSchemaBrief("phase-code");
if (!schemaBrief.includes("task-schema") || !schemaBrief.includes("return: phase-code")) {
  throw new Error("phase-code schema brief is missing expected schemas");
}

const coreRoot = join(import.meta.dir, "..", "..", "accord-core");
const examplePath = join(coreRoot, "schemas", "examples", "phase-code.json");
const packet = JSON.parse(readFileSync(examplePath, "utf8"))[0];
const validation = await validateReturn("phase-code", packet);
if (!validation.valid) {
  throw new Error(validation.errors.join("; "));
}

// ASDLC-1/AC-26 (ASDLC-1/TC-27): default config keeps the per-task commit and creates no stack,
// evidence, state, contract-lock or feature-knowledge files.
const smokeId = "SMK-1";
const smokeCwd = process.cwd();
const smokeRepo = realpathSync(mkdtempSync(join(tmpdir(), "accord-smoke-")));
const smokeGit = (...args: string[]): string =>
  execFileSync("git", args, { cwd: smokeRepo, encoding: "utf8" });
const smokeWrite = (file: string, content: string): void => {
  mkdirSync(dirname(join(smokeRepo, file)), { recursive: true });
  writeFileSync(join(smokeRepo, file), content);
};
try {
  smokeGit("init", "-q", "--initial-branch=main");
  smokeGit("config", "user.email", "smoke@example.com");
  smokeGit("config", "user.name", "Smoke");
  smokeGit("config", "commit.gpgsign", "false");
  smokeWrite(".gitignore", ".tasks/\n");
  smokeWrite("README.md", "# smoke\n");
  smokeGit("add", ".");
  smokeGit("commit", "-q", "-m", "init");
  const taskExample = JSON.parse(
    readFileSync(join(coreRoot, "schemas", "task-file.example.json"), "utf8"),
  );
  taskExample.task = 1;
  taskExample.control.status = "done";
  smokeWrite(
    `.tasks/${smokeId}.json`,
    JSON.stringify({
      schema_version: "1.0",
      id: smokeId,
      title: "Smoke",
      created: "2026-01-01T00:00:00.000Z",
      updated: "2026-01-01T00:00:00.000Z",
      pattern: "implement",
      phase: "implementing",
      task_ids: [1],
      spec: null,
      plan: `docs/dev/${smokeId}/plan.json`,
      verify: null,
      brief: null,
      decisions: [],
      deviations: [],
      cost_usd: 0,
    }),
  );
  smokeWrite(`.tasks/${smokeId}-task-1.json`, JSON.stringify(taskExample));
  smokeWrite(
    `docs/dev/${smokeId}/plan.json`,
    JSON.stringify({
      tasks: [{ id: 1, title: "Smoke task", files: [{ path: "src/smoke.ts", action: "create" }] }],
    }),
  );
  smokeGit("add", "docs");
  smokeGit("commit", "-q", "-m", "plan");
  smokeWrite("src/smoke.ts", "export const smoke = 1;\n");

  process.chdir(smokeRepo);
  const headBefore = smokeGit("rev-parse", "HEAD").trim();
  const smokeConfig = { test: { command: "bun test", file_pattern: "**/*.test.ts" } } as never;
  await tryCommitPhase(
    smokeId,
    1,
    "T1/phase-test",
    "phase-test",
    { status: "done", test_files: [], usage: { prompt_tokens: 1, completion_tokens: 1 } },
    smokeConfig,
    smokeRepo,
  );
  await tryCommitPhase(
    smokeId,
    1,
    "T1/review-test",
    "review-test",
    {
      verdict: "issues",
      findings: [{ severity: "warning", issue: "smoke finding", file: "src/smoke.ts" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    },
    smokeConfig,
    smokeRepo,
  );
  if (smokeGit("rev-parse", "HEAD").trim() !== headBefore) {
    throw new Error("default config made a per-phase commit");
  }
  const { tryCommitOnTaskDone } = await import(
    "@clive.shirley/accord-core/orchestration/commit-on-task-done.js"
  );
  const taskCommit = await tryCommitOnTaskDone(smokeId, 1, smokeConfig, smokeRepo);
  if (!taskCommit.ok || !taskCommit.hash) {
    throw new Error(`per-task commit did not happen: ${JSON.stringify(taskCommit)}`);
  }
  const subject = smokeGit("log", "-1", "--pretty=%s").trim();
  if (subject !== `[${smokeId}] Task 1: Smoke task`) {
    throw new Error(`unexpected per-task commit subject: ${subject}`);
  }
  for (const rel of [
    `docs/dev/${smokeId}/state`,
    `docs/dev/${smokeId}/evidence`,
    `docs/dev/${smokeId}/reviews`,
    `docs/dev/${smokeId}/contract.lock.json`,
    "docs/features",
  ]) {
    if (existsSync(join(smokeRepo, rel))) {
      throw new Error(`default config created ${rel}`);
    }
  }
} finally {
  process.chdir(smokeCwd);
  rmSync(smokeRepo, { recursive: true, force: true });
}

console.log("runtime smoke passed");
