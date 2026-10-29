import { describe, expect, test } from "bun:test";
import {
  resolveKnowledgeConfig,
  resolveReviewSecurityGate,
  resolveStackConfig,
} from "../src/config/stack-flags.js";
import type { DevHarnessConfig } from "../src/config/types.js";

const base = {
  schema_version: "1.0",
  language: "typescript",
  test: { command: "bun test" },
} as const;

function cfg(extra: Record<string, unknown> = {}): DevHarnessConfig {
  return { ...base, ...extra } as unknown as DevHarnessConfig;
}

const DEFAULT_STACK = {
  enabled: false,
  commits: "task",
  provider: "gh",
  state: { persist: "tree", path: "docs/dev/{id}/state", redact: true, max_bytes: 262144 },
  sizing: { max_pr_lines: 400, min_pr_lines: 30, max_files: 10, max_depth: 6, overrun_factor: 1.5 },
};

describe("ASDLC-1/AC-26 resolveStackConfig defaults", () => {
  test("ASDLC-1/AC-26 no stack key: every default, switch off", () => {
    const got = resolveStackConfig(cfg()) as Record<string, unknown>;
    expect(got.enabled).toBe(false);
    expect(got.commits).toBe("task");
    expect(got.provider).toBe("gh");
    expect(got.state).toEqual(DEFAULT_STACK.state);
    expect(got.sizing).toEqual(DEFAULT_STACK.sizing);
  });

  test("ASDLC-1/AC-26 empty stack object equals no stack key", () => {
    const got = resolveStackConfig(cfg({ stack: {} })) as Record<string, unknown>;
    expect(got.enabled).toBe(false);
    expect(got.commits).toBe("task");
    expect(got.state).toEqual(DEFAULT_STACK.state);
    expect(got.sizing).toEqual(DEFAULT_STACK.sizing);
  });

  test("ASDLC-1/AC-26 null config resolves to defaults", () => {
    const got = resolveStackConfig(null) as Record<string, unknown>;
    expect(got.enabled).toBe(false);
    expect(got.commits).toBe("task");
  });

  test("ASDLC-1/AC-26 explicit enabled:false stays false", () => {
    expect(
      (resolveStackConfig(cfg({ stack: { enabled: false } })) as { enabled: boolean }).enabled,
    ).toBe(false);
  });

  test("ASDLC-1/AC-26 enabled:true is honoured, other defaults remain", () => {
    const got = resolveStackConfig(cfg({ stack: { enabled: true } })) as Record<string, unknown>;
    expect(got.enabled).toBe(true);
    expect(got.commits).toBe("task");
    expect(got.provider).toBe("gh");
    expect(got.sizing).toEqual(DEFAULT_STACK.sizing);
  });

  test("ASDLC-1/AC-26 commits 'phase' honoured with stack.enabled unset", () => {
    const got = resolveStackConfig(cfg({ stack: { commits: "phase" } })) as Record<string, unknown>;
    expect(got.commits).toBe("phase");
    expect(got.enabled).toBe(false);
  });

  test("ASDLC-1/AC-26 commits 'phase' honoured with stack.enabled false", () => {
    const got = resolveStackConfig(cfg({ stack: { enabled: false, commits: "phase" } })) as Record<
      string,
      unknown
    >;
    expect(got.commits).toBe("phase");
    expect(got.enabled).toBe(false);
  });

  test("ASDLC-1/AC-26 commits 'task' explicit with enabled true", () => {
    const got = resolveStackConfig(cfg({ stack: { enabled: true, commits: "task" } })) as Record<
      string,
      unknown
    >;
    expect(got.commits).toBe("task");
  });

  test("ASDLC-1/AC-26 partial state and sizing overrides merge over defaults", () => {
    const got = resolveStackConfig(
      cfg({
        stack: {
          provider: "graphite",
          state: { redact: false, max_bytes: 10 },
          sizing: { max_pr_lines: 100, overrun_factor: 2 },
        },
      }),
    ) as Record<string, unknown>;
    expect(got.provider).toBe("graphite");
    expect(got.state).toEqual({
      persist: "tree",
      path: "docs/dev/{id}/state",
      redact: false,
      max_bytes: 10,
    });
    expect(got.sizing).toEqual({ ...DEFAULT_STACK.sizing, max_pr_lines: 100, overrun_factor: 2 });
  });

  test("ASDLC-1/AC-26 does not mutate input config", () => {
    const input = cfg({ stack: { commits: "phase" } });
    const snapshot = JSON.stringify(input);
    resolveStackConfig(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe("ASDLC-1/AC-26 resolveKnowledgeConfig defaults", () => {
  const DEFAULT_KNOWLEDGE = {
    enabled: false,
    root: "docs/features",
    drift_check: "warn",
    max_acs_per_feature: 12,
  };

  test("ASDLC-1/AC-26 no knowledge key: defaults, switch off", () => {
    const got = resolveKnowledgeConfig(cfg()) as Record<string, unknown>;
    expect(got.enabled).toBe(false);
    expect(got.root).toBe("docs/features");
    expect(got.drift_check).toBe("warn");
    expect(got.max_acs_per_feature).toBe(12);
    expect(got).toMatchObject(DEFAULT_KNOWLEDGE);
  });

  test("ASDLC-1/AC-26 null config resolves to defaults", () => {
    expect((resolveKnowledgeConfig(null) as { enabled: boolean }).enabled).toBe(false);
  });

  test("ASDLC-1/AC-26 stack.enabled does not enable knowledge", () => {
    const got = resolveKnowledgeConfig(cfg({ stack: { enabled: true } })) as Record<
      string,
      unknown
    >;
    expect(got.enabled).toBe(false);
  });

  test("ASDLC-1/AC-26 explicit values honoured", () => {
    const got = resolveKnowledgeConfig(
      cfg({
        knowledge: { enabled: true, root: "kb", drift_check: "block", max_acs_per_feature: 3 },
      }),
    ) as Record<string, unknown>;
    expect(got).toMatchObject({
      enabled: true,
      root: "kb",
      drift_check: "block",
      max_acs_per_feature: 3,
    });
  });

  test.each(["off", "warn", "block"])("ASDLC-1/AC-26 drift_check %s honoured", (mode) => {
    expect(
      (resolveKnowledgeConfig(cfg({ knowledge: { drift_check: mode } })) as { drift_check: string })
        .drift_check,
    ).toBe(mode);
  });

  test("ASDLC-1/AC-26 knowledge.enabled does not enable stack", () => {
    expect(
      (resolveStackConfig(cfg({ knowledge: { enabled: true } })) as { enabled: boolean }).enabled,
    ).toBe(false);
  });
});

describe("ASDLC-1/AC-26 resolveReviewSecurityGate", () => {
  const withGate = (gate: string | undefined, stackEnabled?: boolean) =>
    cfg({
      ...(stackEnabled === undefined ? {} : { stack: { enabled: stackEnabled } }),
      orchestration: {
        review_loop: gate === undefined ? {} : { review_security: { severity_gate: gate } },
      },
    });

  test("ASDLC-1/AC-26 unset, no stack key: advisory", () => {
    expect(resolveReviewSecurityGate(cfg())).toBe("advisory");
  });

  test("ASDLC-1/AC-26 null config: advisory", () => {
    expect(resolveReviewSecurityGate(null)).toBe("advisory");
  });

  test("ASDLC-1/AC-26 unset, stack disabled: advisory", () => {
    expect(resolveReviewSecurityGate(withGate(undefined, false))).toBe("advisory");
  });

  test("ASDLC-1/AC-26 unset, stack enabled: warn", () => {
    expect(resolveReviewSecurityGate(withGate(undefined, true))).toBe("warn");
  });

  test("ASDLC-1/AC-26 review_security present but severity_gate unset, stack enabled: warn", () => {
    expect(
      resolveReviewSecurityGate(
        cfg({ stack: { enabled: true }, orchestration: { review_loop: { review_security: {} } } }),
      ),
    ).toBe("warn");
  });

  test("ASDLC-1/AC-26 other review_loop gates do not leak into security gate", () => {
    expect(
      resolveReviewSecurityGate(
        cfg({
          orchestration: {
            review_loop: { severity_gate: "block", review_code: { severity_gate: "block" } },
          },
        }),
      ),
    ).toBe("advisory");
  });

  test.each(["advisory", "none", "warn", "block"])(
    "ASDLC-1/AC-26 explicit %s wins with stack disabled",
    (gate) => {
      expect(resolveReviewSecurityGate(withGate(gate, false))).toBe(gate);
    },
  );

  test.each(["advisory", "none", "warn", "block"])(
    "ASDLC-1/AC-26 explicit %s wins with stack enabled",
    (gate) => {
      expect(resolveReviewSecurityGate(withGate(gate, true))).toBe(gate);
    },
  );

  test.each(["advisory", "none", "block"])(
    "ASDLC-1/AC-26 explicit %s wins with stack key absent",
    (gate) => {
      expect(resolveReviewSecurityGate(withGate(gate))).toBe(gate);
    },
  );
});
