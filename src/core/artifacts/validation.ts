/**
 * JSON schema validation for harness artifacts.
 *
 * Schemas are bundled in ./schemas/ (self-contained for packaging).
 *
 * Two entry points:
 *   validateArtifact(filePath) — validates .tasks/ and docs/ JSON files
 *   validateReturn(agentType, json) — validates an agent return packet
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { isReviewAgent } from "../agents/registry.js";
import { stripJsonc } from "../config/global.js";
import { EXT_DIR } from "../config/paths.js";
import { createLogger } from "../logging.js";
import { WORK_ITEM_FILE_PATTERN } from "../work-items/io.js";

const log = createLogger("validation");

const SCHEMAS = join(EXT_DIR, "schemas");
const RETURN_SCHEMAS = join(SCHEMAS, "return-schemas");

type AjvCompatible = {
  compile: (schema: unknown) => ValidateFn;
};

type ValidateFn = {
  (data: unknown): boolean;
  errors?: Array<{ instancePath?: string; message?: string; params?: unknown }> | null;
};

type AjvError = NonNullable<ValidateFn["errors"]>[number];

// --- ajv lazy init (local dev dependency, then host/global fallback) ---

let ajvInstance: AjvCompatible | null = null;
const validatorCache = new Map<string, ValidateFn>();

async function getAjv(): Promise<AjvCompatible | null> {
  if (ajvInstance) return ajvInstance;
  try {
    // Try bundled ajv in hooks/node_modules, then fall back to global
    const candidates = [join(EXT_DIR, "node_modules", "ajv"), "ajv"];
    for (const candidate of candidates) {
      try {
        const Ajv = (await import(candidate)).default;
        ajvInstance = new Ajv({ allErrors: true, strict: false }) as AjvCompatible;
        return ajvInstance;
      } catch {}
    }
    return null;
  } catch {
    return null;
  }
}

function compileValidator(ajv: AjvCompatible, schemaPath: string, schema: unknown): ValidateFn {
  const cached = validatorCache.get(schemaPath);
  if (cached) return cached;
  const validate = ajv.compile(schema);
  validatorCache.set(schemaPath, validate);
  return validate;
}

// --- Artifact validation (file-based) ---

const SCHEMA_MAP: { match: RegExp; schema: string }[] = [
  { match: /(?:^|-)?spec\.json$/, schema: "spec-schema.json" },
  { match: /(?:^|-)?plan\.json$/, schema: "plan-schema.json" },
  { match: /(?:^|-)?verify\.json$/, schema: "verify-schema.json" },
  { match: /(?:^|-)?brief\.md$/, schema: "" }, // brief is markdown, no JSON schema
  { match: /-checkpoint\.json$/, schema: "checkpoint-schema.json" },
  { match: /-task-\d+\.json$/, schema: "task-schema.json" },
  { match: /-investigation\.json$/, schema: "investigation-schema.json" },
  { match: /^investigate-.*\.json$/, schema: "investigation-schema.json" },
  { match: WORK_ITEM_FILE_PATTERN, schema: "work-item-schema.json" },
];

function pickSchemaName(file: string): string | null {
  const name = basename(file);
  for (const { match, schema } of SCHEMA_MAP) {
    if (match.test(name)) return schema;
  }
  return null;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export async function validateArtifact(filePath: string): Promise<ValidationResult> {
  const schemaName = pickSchemaName(filePath);
  if (!schemaName) return { valid: true, errors: [] }; // unknown file type — skip

  const schemaPath = join(SCHEMAS, schemaName);
  if (!existsSync(schemaPath)) {
    return { valid: true, errors: [`Schema ${schemaName} not found — skipping validation`] };
  }

  const ajv = await getAjv();
  if (!ajv) {
    return { valid: true, errors: ["ajv not available — skipping validation"] };
  }

  let data: unknown;
  try {
    const raw = readFileSync(filePath, "utf8");
    data = JSON.parse(stripJsonc(raw));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn(`JSON parse error in ${filePath}: ${msg}`);
    return { valid: false, errors: [`JSON parse error: ${msg}`] };
  }

  let schema: unknown;
  try {
    schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error(`schema load failed: ${schemaPath}: ${msg}`);
    return { valid: true, errors: [`Schema parse error: ${msg}`] };
  }

  // Check schema_version mismatch (friendly message before ajv)
  const schemaRec = schema as Record<string, unknown> | null;
  const props = schemaRec?.properties as Record<string, unknown> | undefined;
  const schemaVersionProp = props?.schema_version as Record<string, unknown> | undefined;
  const expectedVersion = schemaVersionProp?.const;
  const dataRec = data as Record<string, unknown>;
  if (expectedVersion !== undefined && dataRec.schema_version !== expectedVersion) {
    return {
      valid: false,
      errors: [
        `schema_version mismatch: file has "${String(dataRec.schema_version)}", schema requires "${String(expectedVersion)}"`,
      ],
    };
  }

  const validate = compileValidator(ajv, schemaPath, schema);
  const valid = validate(data);
  if (valid) return { valid: true, errors: [] };

  const errors = (validate.errors || []).map(
    (e: AjvError) =>
      `${e.instancePath || "/"} ${e.message}${e.params ? ` (${JSON.stringify(e.params)})` : ""}`,
  );
  return { valid: false, errors };
}

// --- Return packet validation ---

function returnSchemaFor(agentType: string): string {
  if (isReviewAgent(agentType)) return "review.json";
  return `${agentType}.json`;
}

/**
 * Auto-downgrade review findings without file+line to severity=suggestion,
 * matching the behaviour of validate-return.mjs.
 */
function normaliseReviewFindings(data: unknown): void {
  if (!data || typeof data !== "object") return;
  const rec = data as Record<string, unknown>;
  const findings = rec.findings;
  if (!Array.isArray(findings)) return;
  for (const item of findings) {
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    if (f.severity !== "suggestion" && (!f.file || !f.line)) {
      f.severity = "suggestion";
    }
  }
}

export async function validateReturn(agentType: string, data: unknown): Promise<ValidationResult> {
  const schemaFile = returnSchemaFor(agentType);
  const schemaPath = join(RETURN_SCHEMAS, schemaFile);

  if (!existsSync(schemaPath)) {
    return { valid: true, errors: ["No return schema found — skipping"] };
  }

  const ajv = await getAjv();
  if (!ajv) {
    return { valid: true, errors: ["ajv not available — skipping"] };
  }

  // Normalise review findings before validation
  if (isReviewAgent(agentType)) {
    normaliseReviewFindings(data);
  }

  let schema: unknown;
  try {
    schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    log.error(`return schema load failed: ${schemaPath}: ${msg}`);
    return { valid: true, errors: [`Schema parse error: ${msg}`] };
  }

  const validate = compileValidator(ajv, schemaPath, schema);
  const valid = validate(data);
  if (valid) return { valid: true, errors: [] };

  const errors = (validate.errors || []).map(
    (e: AjvError) =>
      `${e.instancePath || "/"} ${e.message}${e.params ? ` (${JSON.stringify(e.params)})` : ""}`,
  );
  return { valid: false, errors };
}
