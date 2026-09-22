import { describe, expect, test } from "bun:test";

import {
  type GithubEventPayload,
  MissingDispatchFieldError,
  readDispatch,
} from "../src/dispatch.js";

describe("readDispatch (AC-1, TC-20)", () => {
  test("(a) workflow_call with inputs.ticket → returns { ticket, statusAtTrigger: null }", () => {
    const payload: GithubEventPayload = {
      eventName: "workflow_call",
      inputs: { ticket: "PROJ-123" },
    };
    expect(readDispatch(payload)).toEqual({
      ticket: "PROJ-123",
      statusAtTrigger: null,
    });
  });

  test("(b) repository_dispatch with client_payload.ticket + status_at_trigger → returns both", () => {
    const payload: GithubEventPayload = {
      eventName: "repository_dispatch",
      clientPayload: { ticket: "PROJ-456", status_at_trigger: "Ready for Autopilot" },
    };
    expect(readDispatch(payload)).toEqual({
      ticket: "PROJ-456",
      statusAtTrigger: "Ready for Autopilot",
    });
  });

  test("(c) repository_dispatch missing ticket → throws MISSING_REQUIRED_DISPATCH_FIELD: ticket", () => {
    const payload: GithubEventPayload = {
      eventName: "repository_dispatch",
      clientPayload: { status_at_trigger: "Ready for Autopilot" },
    };
    let thrown: unknown;
    try {
      readDispatch(payload);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(MissingDispatchFieldError);
    expect((thrown as Error).message).toBe("MISSING_REQUIRED_DISPATCH_FIELD: ticket");
  });

  test("(d) repository_dispatch missing status_at_trigger → throws MISSING_REQUIRED_DISPATCH_FIELD: status_at_trigger", () => {
    const payload: GithubEventPayload = {
      eventName: "repository_dispatch",
      clientPayload: { ticket: "PROJ-456" },
    };
    let thrown: unknown;
    try {
      readDispatch(payload);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(MissingDispatchFieldError);
    expect((thrown as Error).message).toBe("MISSING_REQUIRED_DISPATCH_FIELD: status_at_trigger");
  });

  test("workflow_call missing ticket → throws MISSING_REQUIRED_DISPATCH_FIELD: ticket", () => {
    const payload: GithubEventPayload = {
      eventName: "workflow_call",
      inputs: {},
    };
    let thrown: unknown;
    try {
      readDispatch(payload);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(MissingDispatchFieldError);
    expect((thrown as Error).message).toBe("MISSING_REQUIRED_DISPATCH_FIELD: ticket");
  });

  test("empty-string ticket counts as missing (defence in depth)", () => {
    const payload: GithubEventPayload = {
      eventName: "repository_dispatch",
      clientPayload: { ticket: "", status_at_trigger: "Ready" },
    };
    let thrown: unknown;
    try {
      readDispatch(payload);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(MissingDispatchFieldError);
    expect((thrown as Error).message).toBe("MISSING_REQUIRED_DISPATCH_FIELD: ticket");
  });

  test("unknown eventName throws (no silent fallback)", () => {
    const payload = { eventName: "push" } as unknown as GithubEventPayload;
    expect(() => readDispatch(payload)).toThrow();
  });
});

describe("MissingDispatchFieldError class", () => {
  test("is distinguishable for catch-and-translate", () => {
    const err = new MissingDispatchFieldError("ticket");
    expect(err).toBeInstanceOf(MissingDispatchFieldError);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("MissingDispatchFieldError");
    expect(err.fieldName).toBe("ticket");
    expect(err.message).toBe("MISSING_REQUIRED_DISPATCH_FIELD: ticket");
  });
});

// -----------------------------------------------------------------------
// Integration tests for the dispatch.ts CLI entry point.
//
// History: the original implementation read `GITHUB_EVENT_NAME` only.
// On real GitHub runners, `GITHUB_EVENT_NAME` inside a reusable workflow
// always reflects the OUTER event (e.g. `workflow_dispatch`) and is
// runner-reserved (step `env:` overrides are silently ignored). The
// workflow YAML therefore passes the canonical kind via the non-reserved
// `ACCORD_DISPATCH_KIND` variable. These tests pin that precedence so
// the regression cannot recur silently.
// -----------------------------------------------------------------------

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function runDispatch(env: Record<string, string | undefined>): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  const cleanEnv: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (typeof v === "string") cleanEnv[k] = v;
  }
  if (!cleanEnv.PATH) cleanEnv.PATH = process.env.PATH ?? "";
  const script = join(import.meta.dir, "../src/dispatch.ts");
  const result = spawnSync("bun", ["run", script], { env: cleanEnv, encoding: "utf8" });
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.status ?? -1,
  };
}

function withEventFile(payload: unknown, action: (path: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "accord-dispatch-"));
  const path = join(dir, "event.json");
  writeFileSync(path, JSON.stringify(payload));
  try {
    action(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("dispatch.ts CLI env-var precedence (real-runner contract)", () => {
  test("ACCORD_DISPATCH_KIND=workflow_call overrides GITHUB_EVENT_NAME=workflow_dispatch", () => {
    withEventFile({ inputs: { ticket: "PROJ-7" } }, (eventPath) => {
      const result = runDispatch({
        ACCORD_DISPATCH_KIND: "workflow_call",
        GITHUB_EVENT_NAME: "workflow_dispatch",
        GITHUB_EVENT_PATH: eventPath,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("ticket=PROJ-7");
      expect(result.stdout).toContain("status_at_trigger=");
    });
  });

  test("ACCORD_DISPATCH_KIND=repository_dispatch routes to client_payload (real consumer flow)", () => {
    withEventFile(
      { client_payload: { ticket: "PROJ-9", status_at_trigger: "Ready" } },
      (eventPath) => {
        const result = runDispatch({
          ACCORD_DISPATCH_KIND: "repository_dispatch",
          GITHUB_EVENT_NAME: "repository_dispatch",
          GITHUB_EVENT_PATH: eventPath,
        });
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("ticket=PROJ-9");
        expect(result.stdout).toContain("status_at_trigger=Ready");
      },
    );
  });

  test("falls back to GITHUB_EVENT_NAME when ACCORD_DISPATCH_KIND is unset", () => {
    withEventFile(
      { client_payload: { ticket: "PROJ-1", status_at_trigger: "Open" } },
      (eventPath) => {
        const result = runDispatch({
          GITHUB_EVENT_NAME: "repository_dispatch",
          GITHUB_EVENT_PATH: eventPath,
        });
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toContain("ticket=PROJ-1");
      },
    );
  });

  test("empty ACCORD_DISPATCH_KIND falls back to GITHUB_EVENT_NAME", () => {
    // Defensive: a stray empty assignment in YAML must not eclipse the
    // real GITHUB_EVENT_NAME signal.
    withEventFile({ inputs: { ticket: "PROJ-2" } }, (eventPath) => {
      const result = runDispatch({
        ACCORD_DISPATCH_KIND: "",
        GITHUB_EVENT_NAME: "workflow_call",
        GITHUB_EVENT_PATH: eventPath,
      });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain("ticket=PROJ-2");
    });
  });

  test("neither variable set → MISSING_REQUIRED_DISPATCH_FIELD on stderr, non-zero exit", () => {
    withEventFile({ inputs: { ticket: "X" } }, (eventPath) => {
      const result = runDispatch({ GITHUB_EVENT_PATH: eventPath });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("MISSING_REQUIRED_DISPATCH_FIELD");
      expect(result.stderr).toContain("ACCORD_DISPATCH_KIND");
      expect(result.stderr).toContain("GITHUB_EVENT_NAME");
    });
  });

  test("invalid ACCORD_DISPATCH_KIND throws UNSUPPORTED_DISPATCH_EVENT (allow-list intact)", () => {
    withEventFile({}, (eventPath) => {
      const result = runDispatch({
        ACCORD_DISPATCH_KIND: "push",
        GITHUB_EVENT_PATH: eventPath,
      });
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("UNSUPPORTED_DISPATCH_EVENT: push");
    });
  });
});
