/** Optional harness orchestration overrides (see `schemas/accord-schema.json`). */
export interface DevHarnessOrchestrationConfig {
  /**
   * Caps and severity gating for quick-fix `review-test` → `phase-test` retries.
   * Omitted fields fall back to `defaultQuickFixLoopPolicy()` in `src/core/orchestration/policy.ts`.
   */
  quick_fix_loop?: {
    /** Max post-review-test retries toward `phase-test` before task `status` is set to `blocked`. */
    max_test_review_loops?: number;
    /** Which finding severities consume a retry slot when verdict is `issues`. */
    severity_gate?: "none" | "warn" | "block";
  };
  /**
   * Optional **implement** pipeline gates (challenge / `reviews_requested` → **review-code** before verify).
   * Omitted fields fall back to {@link defaultImplementCodeReviewPolicy} in `src/core/orchestration/policy.ts`.
   */
  implement_loop?: {
    code_review_on_challenge?: boolean;
    code_review_on_reviews_requested?: boolean;
  };
  /**
   * Critical finding retries after **review-test** / **review-code** (persisted on the task file).
   * Default max: 3 (`DEFAULT_MAX_CRITICAL_REVIEW_RETRIES`).
   */
  review_loop?: {
    max_critical_retries?: number;
  };
  /**
   * Bounded LLM output merged into resume task text (Phase 5). Never selects agents —
   * only the shape in `schemas/orchestration-judgment-packet.json`. Pi calls the model when
   * `ACCORD_ORCHESTRATION_JUDGMENT=1` and `enabled` is true; invalid JSON falls back to a template appendix.
   */
  judgment?: {
    enabled?: boolean;
    /** Dispatch agent registry ids that receive judgment (default: review-test, phase-test). */
    agents?: string[];
    max_tokens?: number;
  };
  /**
   * `/dev resume` replan loop: which agents may chain in one command and how many spawns max.
   * Defaults match `src/core/orchestration/policy.ts`.
   */
  resume?: {
    /**
     * Registry agent ids that stop the replan loop when they are the *next* spawn
     * (default: `["phase-code"]`). Set `[]` to allow chaining into implementation.
     */
    no_auto_chain_agents?: string[];
    /** Max subagent spawns per `/dev resume` (default: 8). */
    max_sequential_spawns?: number;
  };
  /**
   * Git commit behaviour during orchestrated implementation (Pi host only).
   */
  commit?: {
    /**
     * After **review-code** marks a task `done`, stage task-scoped files and commit
     * without interactive confirmation (default: false).
     */
    on_task_done?: boolean;
  };
}

export interface DevHarnessConfig {
  schema_version: "1.0";
  language: string;
  detect_file?: string;
  test: {
    command: string;
    single_test_flag?: string;
    file_pattern?: string;
    block_markers?: string[];
  };
  type_check: string | null;
  lint: string | null;
  format: string | null;
  verification_commands: string[];
  monorepo?: {
    tool?: string;
    root?: string;
  };
  tracker?: {
    type: TrackerType;
    project_prefix?: string;
  };
  context_sources?: ContextSourceConfig[];
  /**
   * User-defined provider declarations. Each entry adds (or overrides
   * by name) a tracker or enrichment provider. Bundled providers from
   * assets/providers/ are always available; entries here let projects
   * swap a playbook, point at a custom MCP/CLI/env tool, or add an
   * entirely new provider. Validated against schemas/accord-schema.json
   * (`providers` field) and normalised by integrations/provider-deps.ts.
   */
  providers?: UserProviderDef[];
  log_level?: "debug" | "info" | "warn" | "error" | "silent";
  orchestration?: DevHarnessOrchestrationConfig;
}

export interface ContextSourceConfig {
  /**
   * Enrichment source name. Bundled enrichments are slack, google-docs,
   * confluence, github-pr, github-discussions, figma. User-defined
   * enrichments declared via `providers` add to this set. Free-form
   * string at the type level so the loader can validate against the
   * merged provider set at runtime.
   */
  type: string;
  enabled?: boolean;
  default_lookback_days?: number;
  base_url?: string;
  channels?: string[];
  space?: string;
  labels?: string[];
  folder_id?: string;
  /** Source-specific scoping fields are passed through unchanged. */
  [key: string]: unknown;
}

export interface UserProviderDef {
  name: string;
  kind: "tracker" | "enrichment";
  label?: string;
  mcpTools?: string[];
  cliFallback?: string | null;
  envFallback?: string | null;
  /** Absolute or ~/-prefixed path to the markdown fetch playbook. */
  promptFile: string;
}

export interface DevHarnessGlobalConfig {
  context_sources?: ContextSourceConfig[];
  /**
   * Default orchestration overrides for every project with a Dev Harness block.
   * Project `orchestration` in AGENTS.md is shallow-merged on top (per subsection).
   */
  orchestration?: DevHarnessOrchestrationConfig;
  providers?: UserProviderDef[];
  /**
   * Per-developer-machine extension bootstrap preferences. Read by
   * core/harness/asset-bootstrap.ts at Pi session_start. Only valid in
   * the global ~/.config/pi/agent/accord.json — projects cannot
   * influence the bootstrap because their AGENTS.md is loaded after
   * the bootstrap runs.
   */
  asset_bootstrap?: {
    /**
     * When false, the extension never auto-links bundled assets. It still
     * detects drift and warns. Overridden by the
     * ACCORD_AUTO_INSTALL_ASSETS env var when set. Default: true.
     */
    auto_install?: boolean;
  };
}

export interface LangProfile {
  language: string;
  extensions: string[];
  detect: string;
  detect_alt?: string[];
  checks: Record<string, string | null>;
  test_meta?: {
    single_test_flag?: string;
    file_pattern?: string;
    block_markers?: string[];
  };
}

/**
 * Tracker provider name. Bundled trackers are jira, github, gitlab,
 * plain-text. User-defined trackers (declared via `providers`) extend
 * this set, so the alias is `string` rather than a closed union — the
 * loader validates against the merged provider set at runtime.
 */
export type TrackerType = string;

export interface BuildResult {
  config: DevHarnessConfig;
  notes: string[];
}
