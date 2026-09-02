import { type TSchema, Type } from "typebox";

/** Build a TypeBox string enum schema without importing Pi SDK helpers. */
export function stringEnum<const T extends readonly string[]>(
  values: T,
  options?: { description?: string },
): TSchema {
  const literals = values.map((value) => Type.Literal(value));
  const schema = literals.length === 1 ? literals[0]! : Type.Union(literals);
  if (options?.description) {
    return { ...schema, description: options.description } as TSchema;
  }
  return schema;
}

export const intentModeEnum = stringEnum([
  "narrow_change",
  "pipeline",
  "review",
  "commit",
  "explain",
  "investigate",
] as const);

export const confidenceEnum = stringEnum(["high", "medium", "low"] as const);

export const escalationCeilingEnum = stringEnum([
  "pipeline_allowed",
  "no_pipeline_without_confirmation",
  "no_implementation_without_confirmation",
  "read_only_until_confirmed",
  "no_edits",
] as const);

export const patternEnum = stringEnum(
  ["implement", "quick_fix", "investigate", "infra", "analyse"] as const,
  { description: "Pattern: implement, quick_fix, investigate, infra, analyse" },
);

export const variantEnum = stringEnum(["express", "standard", "orchestrated"] as const, {
  description: "Variant: standard, express, orchestrated",
});

export const terminalOutcomeEnum = stringEnum([
  "done",
  "blocked",
  "partially_achieved",
  "unclear",
] as const);

export const checkpointActionEnum = stringEnum(["read", "write", "delete"] as const);

export const initWriteTargetEnum = stringEnum(
  ["local", "root", "root_replace", "link_only"] as const,
  {
    description:
      "Where to write: 'local' (cwd only), 'root' (root + link), 'root_replace' (replace root + link), 'link_only' (ref directive only)",
  },
);
