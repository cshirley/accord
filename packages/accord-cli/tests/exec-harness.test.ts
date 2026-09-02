import { describe, expect, test } from "bun:test";
import { runExecSpawn } from "../src/harnesses/exec.js";
import { renderExecCommand, renderExecCommandArg } from "../src/harnesses/exec-template.js";

describe("exec harness templates", () => {
  test("render command argv tokens", () => {
    const vars = {
      agent: "phase-gather",
      agentId: "phase-gather",
      task: "Gather context",
      taskFile: "/tmp/task.md",
      cwd: "/repo",
    };
    expect(renderExecCommandArg("--agent={{agentId}}", vars)).toBe("--agent=phase-gather");
    expect(
      renderExecCommand(["runner", "--task-file", "{{taskFile}}", "--cwd", "{{cwd}}"], vars),
    ).toEqual(["runner", "--task-file", "/tmp/task.md", "--cwd", "/repo"]);
  });
});

describe("exec harness spawn", () => {
  test("parses fenced json from stdout", async () => {
    const script = [
      "#!/usr/bin/env bun",
      'const taskPath = process.argv.find((arg) => arg.startsWith("--task-file="))?.slice("--task-file=".length);',
      "if (!taskPath) process.exit(2);",
      "const task = await Bun.file(taskPath).text();",
      'console.log("worked on", task.trim());',
      'console.log("```json");',
      'console.log(JSON.stringify({ status: "done", summary: "ok" }));',
      'console.log("```");',
    ].join("\n");
    const scriptPath = `/tmp/accord-exec-test-${String(Date.now())}.ts`;
    await Bun.write(scriptPath, script);

    const result = await runExecSpawn(
      { agent: "phase-gather", task: "hello task" },
      process.cwd(),
      {
        command: ["bun", scriptPath, "--task-file={{taskFile}}"],
        response_json: "stdout",
      },
    );

    expect(result.exitCode).toBe(0);
    expect(result.parsedReturn).toEqual({ status: "done", summary: "ok" });
    expect(result.output).toContain("worked on hello task");
  });
});
