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
   * entirely new provider. Validated against schemas/accord-config-schema.json
   * (`providers` field) and normalised by integrations/provider-deps.ts.
   */
  providers?: UserProviderDef[];
  log_level?: "debug" | "info" | "warn" | "error" | "silent";
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
  providers?: UserProviderDef[];
  /**
   * Per-developer-machine extension bootstrap preferences. Read by
   * core/harness/asset-bootstrap.ts at Pi session_start. Only valid in
   * the global ~/.config/pi/agent/accord-config.json — projects cannot
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
