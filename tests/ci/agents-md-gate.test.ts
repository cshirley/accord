import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAgentsMdGate } from "../../scripts/ci/gate-agents-md.js";

function makeRepo(contents: string | null): string {
  const dir = mkdtempSync(join(tmpdir(), "accord-agents-md-gate-"));
  if (contents !== null) {
    writeFileSync(join(dir, "AGENTS.md"), contents, "utf8");
  }
  return dir;
}

function cleanup(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

const GATE_CFG = { transitionOnFailure: "Needs Triage" } as const;

describe("runAgentsMdGate — AC-2 sub-checks", () => {
  test("(a) AGENTS.md missing → ok=false, subCheck='missing file'", () => {
    const dir = makeRepo(null);
    try {
      const r = runAgentsMdGate(dir, GATE_CFG);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.subCheck).toBe("missing file");
        expect(r.remediation).toContain("AGENTS.md");
        expect(r.remediation).toContain("repo root");
        expect(r.transition).toBe("Needs Triage");
      }
    } finally {
      cleanup(dir);
    }
  });

  test("(b) AGENTS.md present without `## Dev Harness` → ok=false, subCheck='missing section'", () => {
    const dir = makeRepo("# Repo\n\nSome other text. No Dev Harness section.\n");
    try {
      const r = runAgentsMdGate(dir, GATE_CFG);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.subCheck).toBe("missing section");
        expect(r.remediation).toContain("## Dev Harness");
      }
    } finally {
      cleanup(dir);
    }
  });

  test("(c) `## Dev Harness` present but first json block fails to parse → ok=false, subCheck='malformed JSON'", () => {
    const md = ["## Dev Harness", "", "```json", "{ not valid json", "```", ""].join("\n");
    const dir = makeRepo(md);
    try {
      const r = runAgentsMdGate(dir, GATE_CFG);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.subCheck).toBe("malformed JSON");
      }
    } finally {
      cleanup(dir);
    }
  });

  test("(d) JSON parses but test.command is missing → ok=false, subCheck='missing test.command'", () => {
    const md = [
      "## Dev Harness",
      "",
      "```json",
      JSON.stringify({ schema_version: "1.0", language: "typescript" }),
      "```",
    ].join("\n");
    const dir = makeRepo(md);
    try {
      const r = runAgentsMdGate(dir, GATE_CFG);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.subCheck).toBe("missing test.command");
      }
    } finally {
      cleanup(dir);
    }
  });

  test("(d) JSON parses but test.command is null → ok=false, subCheck='missing test.command'", () => {
    const md = [
      "## Dev Harness",
      "",
      "```json",
      JSON.stringify({ test: { command: null } }),
      "```",
    ].join("\n");
    const dir = makeRepo(md);
    try {
      const r = runAgentsMdGate(dir, GATE_CFG);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.subCheck).toBe("missing test.command");
    } finally {
      cleanup(dir);
    }
  });

  test("(d adversary) JSON parses but test.command is non-string number → ok=false, subCheck='missing test.command'", () => {
    const md = [
      "## Dev Harness",
      "",
      "```json",
      JSON.stringify({ test: { command: 42 } }),
      "```",
    ].join("\n");
    const dir = makeRepo(md);
    try {
      const r = runAgentsMdGate(dir, GATE_CFG);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.subCheck).toBe("missing test.command");
    } finally {
      cleanup(dir);
    }
  });

  test("(d adversary) test.command is empty string → ok=false, subCheck='missing test.command'", () => {
    const md = [
      "## Dev Harness",
      "",
      "```json",
      JSON.stringify({ test: { command: "" } }),
      "```",
    ].join("\n");
    const dir = makeRepo(md);
    try {
      const r = runAgentsMdGate(dir, GATE_CFG);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.subCheck).toBe("missing test.command");
    } finally {
      cleanup(dir);
    }
  });

  test("(e) all-good fixture → ok=true", () => {
    const md = [
      "# My Repo",
      "",
      "## Dev Harness",
      "",
      "```json",
      JSON.stringify({ schema_version: "1.0", test: { command: "bun test" } }, null, 2),
      "```",
    ].join("\n");
    const dir = makeRepo(md);
    try {
      const r = runAgentsMdGate(dir, GATE_CFG);
      expect(r.ok).toBe(true);
    } finally {
      cleanup(dir);
    }
  });
});

describe("runAgentsMdGate — adversary: section-scoping", () => {
  test("json block OUTSIDE ## Dev Harness section must NOT satisfy the gate", () => {
    // valid json with test.command, but BEFORE the section header → not in scope.
    const md = [
      "# Some intro",
      "",
      "```json",
      JSON.stringify({ test: { command: "bun test" } }),
      "```",
      "",
      "## Dev Harness",
      "",
      "(no json block here)",
    ].join("\n");
    const dir = makeRepo(md);
    try {
      const r = runAgentsMdGate(dir, GATE_CFG);
      // No json block IN the section → should fail "malformed JSON" or "missing test.command";
      // either way, ok must be false.
      expect(r.ok).toBe(false);
    } finally {
      cleanup(dir);
    }
  });

  test("first json block in section is consumed even if a later one would also be valid", () => {
    const md = [
      "## Dev Harness",
      "",
      "```json",
      "{ broken",
      "```",
      "",
      "```json",
      JSON.stringify({ test: { command: "bun test" } }),
      "```",
    ].join("\n");
    const dir = makeRepo(md);
    try {
      const r = runAgentsMdGate(dir, GATE_CFG);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.subCheck).toBe("malformed JSON");
    } finally {
      cleanup(dir);
    }
  });

  test("section is bounded by the next ## heading (does not bleed into following sections)", () => {
    const md = [
      "## Dev Harness",
      "",
      "(no json block)",
      "",
      "## Other Section",
      "",
      "```json",
      JSON.stringify({ test: { command: "bun test" } }),
      "```",
    ].join("\n");
    const dir = makeRepo(md);
    try {
      const r = runAgentsMdGate(dir, GATE_CFG);
      // The json belongs to "Other Section", not Dev Harness → gate fails.
      expect(r.ok).toBe(false);
    } finally {
      cleanup(dir);
    }
  });

  test("section header must match literally — `## dev harness` (lowercase) does NOT satisfy", () => {
    const md = [
      "## dev harness",
      "",
      "```json",
      JSON.stringify({ test: { command: "bun test" } }),
      "```",
    ].join("\n");
    const dir = makeRepo(md);
    try {
      const r = runAgentsMdGate(dir, GATE_CFG);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.subCheck).toBe("missing section");
    } finally {
      cleanup(dir);
    }
  });

  test("section header matches even with trailing whitespace on the line", () => {
    const md = [
      "## Dev Harness   ",
      "",
      "```json",
      JSON.stringify({ test: { command: "bun test" } }),
      "```",
    ].join("\n");
    const dir = makeRepo(md);
    try {
      const r = runAgentsMdGate(dir, GATE_CFG);
      expect(r.ok).toBe(true);
    } finally {
      cleanup(dir);
    }
  });
});

describe("runAgentsMdGate — no subprocess spawning (TC-1)", () => {
  test("gate completes synchronously and does not return a Promise", () => {
    const dir = makeRepo(null);
    try {
      const r = runAgentsMdGate(dir, GATE_CFG);
      expect(r).not.toBeInstanceOf(Promise);
    } finally {
      cleanup(dir);
    }
  });
});
