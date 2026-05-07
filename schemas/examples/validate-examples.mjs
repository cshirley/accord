#!/usr/bin/env node
/**
 * Validates example files against their return schemas.
 * Checks: required fields present, enum values valid, type matches.
 * No external deps — uses basic JSON schema interpretation.
 *
 * Usage: node validate-examples.mjs
 * Exit 0 = all valid, Exit 1 = validation failures
 */

import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMAS_DIR = join(__dirname, "..");
const EXAMPLES_DIR = join(SCHEMAS_DIR, "examples");
const RETURN_SCHEMAS_DIR = join(SCHEMAS_DIR, "return-schemas");

let failures = 0;
let passes = 0;

function validateValue(value, schema, path) {
  const errors = [];

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: value "${value}" not in enum [${schema.enum.join(", ")}]`);
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    const actualType = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
    // JSON has no integer type — treat integer as number for validation
    const normalised = types.map(t => t === "integer" ? "number" : t);
    if (!normalised.includes(actualType)) {
      errors.push(`${path}: expected type ${types.join("|")}, got ${actualType}`);
    }
  }

  if (schema.type === "object" && schema.properties && typeof value === "object" && value !== null) {
    // Check required fields
    if (schema.required) {
      for (const req of schema.required) {
        if (!(req in value)) {
          errors.push(`${path}: missing required field "${req}"`);
        }
      }
    }
    // Check additionalProperties
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!schema.properties[key]) {
          errors.push(`${path}: unexpected field "${key}"`);
        }
      }
    }
    // Recurse into properties
    for (const [key, val] of Object.entries(value)) {
      if (schema.properties[key]) {
        errors.push(...validateValue(val, schema.properties[key], `${path}.${key}`));
      }
    }
  }

  if (schema.type === "array" && schema.items && Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      errors.push(...validateValue(value[i], schema.items, `${path}[${i}]`));
    }
  }

  return errors;
}

function validateExample(example, schema, label) {
  const errors = [];

  // Top-level required fields (always required)
  if (schema.required) {
    for (const req of schema.required) {
      if (!(req in example)) {
        errors.push(`/: missing required field "${req}"`);
      }
    }
  }

  // Check additionalProperties at top level
  if (schema.additionalProperties === false && schema.properties) {
    for (const key of Object.keys(example)) {
      if (!schema.properties[key]) {
        errors.push(`/: unexpected field "${key}"`);
      }
    }
  }

  // Validate each field against its property schema
  if (schema.properties) {
    for (const [key, val] of Object.entries(example)) {
      if (schema.properties[key]) {
        errors.push(...validateValue(val, schema.properties[key], `/${key}`));
      }
    }
  }

  // Check conditional requirements (allOf with if/then)
  if (schema.allOf) {
    for (const rule of schema.allOf) {
      if (rule.if && rule.then) {
        // Check if condition matches
        const ifProps = rule.if.properties || {};
        let matches = true;
        for (const [key, constraint] of Object.entries(ifProps)) {
          if (constraint.const && example[key] !== constraint.const) {
            matches = false;
            break;
          }
        }
        if (matches && rule.then.required) {
          for (const req of rule.then.required) {
            if (!(req in example)) {
              errors.push(`/: conditional required field "${req}" missing (when status="${example.status || example.verdict}")`);
            }
          }
        }
      }
    }
  }

  return errors;
}

const exampleFiles = readdirSync(EXAMPLES_DIR).filter(f => f.endsWith(".json"));

for (const exampleFile of exampleFiles) {
  const schemaPath = join(RETURN_SCHEMAS_DIR, exampleFile);
  let schema;
  try {
    schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  } catch (e) {
    console.error(`✗ ${exampleFile} — schema not found at return-schemas/${exampleFile}`);
    failures++;
    continue;
  }

  const examples = JSON.parse(readFileSync(join(EXAMPLES_DIR, exampleFile), "utf8"));

  for (let i = 0; i < examples.length; i++) {
    const example = examples[i];
    const label = `${exampleFile}[${i}] (status: ${example.status || example.verdict || "?"})`;
    const errors = validateExample(example, schema, label);

    if (errors.length === 0) {
      console.log(`✓ ${label}`);
      passes++;
    } else {
      console.error(`✗ ${label}`);
      for (const err of errors) {
        console.error(`    ${err}`);
      }
      failures++;
    }
  }
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
