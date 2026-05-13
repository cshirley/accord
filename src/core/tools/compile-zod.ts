/**
 * Walks the JSON-Schema-like AST emitted by TypeBox and produces an equivalent
 * Zod schema for the MCP adapter. Supports the subset used by ACCORD tools:
 * string / number / boolean / null primitives, string enums, string literals
 * (via `Type.Literal`), arrays, objects (with `required` + `additionalProperties`),
 * and `anyOf` unions. Each schema's `description` is forwarded via `.describe(...)`.
 *
 * Anything outside this subset is treated as `z.unknown()` so the MCP server
 * still accepts the call — TypeBox remains the source of truth for validation
 * inside the Pi side, and core handlers stay defensive about `unknown` shapes.
 */

import { type ZodRawShape, type ZodTypeAny, z } from "zod";

type Schema = Record<string, unknown>;

function describe<T extends ZodTypeAny>(zod: T, schema: Schema): T {
  const description = schema.description;
  if (typeof description === "string" && description.length > 0) {
    return zod.describe(description) as T;
  }
  return zod;
}

export function compileSchemaToZod(schema: unknown): ZodTypeAny {
  if (!schema || typeof schema !== "object") {
    return z.unknown();
  }
  const s = schema as Schema;

  if (Array.isArray(s.anyOf)) {
    const variants = (s.anyOf as unknown[]).map((v) => compileSchemaToZod(v));
    if (variants.length === 1) {
      const only = variants[0];
      return only ? describe(only, s) : z.unknown();
    }
    const [first, second, ...rest] = variants;
    if (!first || !second) {
      return z.unknown();
    }
    return describe(z.union([first, second, ...rest]), s);
  }

  if (typeof s.const === "string") {
    return describe(z.literal(s.const), s);
  }

  const type = s.type;
  switch (type) {
    case "string": {
      if (Array.isArray(s.enum) && s.enum.every((v) => typeof v === "string")) {
        const values = s.enum as string[];
        const [first, ...rest] = values;
        if (!first) {
          return describe(z.string(), s);
        }
        return describe(z.enum([first, ...rest] as [string, ...string[]]), s);
      }
      return describe(z.string(), s);
    }
    case "number":
      return describe(z.number(), s);
    case "boolean":
      return describe(z.boolean(), s);
    case "null":
      return describe(z.null(), s);
    case "array": {
      const items = compileSchemaToZod(s.items);
      return describe(z.array(items), s);
    }
    case "object": {
      const shape = compileObjectShape(s);
      const additional = s.additionalProperties;
      const base = z.object(shape);
      const obj = additional === true ? base.passthrough() : base;
      return describe(obj, s);
    }
    default:
      return describe(z.unknown(), s);
  }
}

function compileObjectShape(schema: Schema): ZodRawShape {
  const properties = (schema.properties as Record<string, unknown> | undefined) ?? {};
  const required = new Set<string>(
    Array.isArray(schema.required)
      ? (schema.required as unknown[]).filter((item): item is string => typeof item === "string")
      : [],
  );

  const shape: Record<string, ZodTypeAny> = {};
  for (const [name, raw] of Object.entries(properties)) {
    const compiled = compileSchemaToZod(raw);
    shape[name] = required.has(name) ? compiled : compiled.optional();
  }
  return shape as ZodRawShape;
}

/**
 * Compiles the top-level object schema for an MCP tool. MCP wants `inputSchema`
 * as a `ZodRawShape` (map of property name → ZodType), not a wrapping `z.object`.
 */
export function compileSchemaToZodShape(schema: unknown): ZodRawShape {
  if (!schema || typeof schema !== "object") {
    return {};
  }
  const s = schema as Schema;
  if (s.type !== "object") {
    return {};
  }
  return compileObjectShape(s);
}
