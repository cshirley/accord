import { StringEnum } from "@earendil-works/pi-ai";

export const intentModeEnum = StringEnum([
  "narrow_change",
  "pipeline",
  "review",
  "commit",
  "explain",
  "investigate",
] as const);

export const confidenceEnum = StringEnum(["high", "medium", "low"] as const);

export const escalationCeilingEnum = StringEnum([
  "pipeline_allowed",
  "no_pipeline_without_confirmation",
  "no_implementation_without_confirmation",
  "read_only_until_confirmed",
  "no_edits",
] as const);

export const patternEnum = StringEnum(
  ["implement", "quick_fix", "investigate", "infra", "analyse"] as const,
  { description: "Pattern: implement, quick_fix, investigate, infra, analyse" },
);

export const variantEnum = StringEnum(["express", "standard", "orchestrated"] as const, {
  description: "Variant: standard, express, orchestrated",
});

export const terminalOutcomeEnum = StringEnum([
  "done",
  "blocked",
  "partially_achieved",
  "unclear",
] as const);

export const checkpointActionEnum = StringEnum(["read", "write", "delete"] as const);

export const initWriteTargetEnum = StringEnum(
  ["local", "root", "root_replace", "link_only"] as const,
  {
    description:
      "Where to write: 'local' (cwd only), 'root' (root + link), 'root_replace' (replace root + link), 'link_only' (ref directive only)",
  },
);
