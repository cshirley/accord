import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateReturn } from "../src/core/artifacts/validation.js";
import { devDispatch } from "../src/core/commands/dispatch.js";
import { formatSchemaBrief } from "../src/core/crucible/verification.js";

const route = devDispatch("help");
if (route.type !== "known" || route.subcommand !== "help") {
  throw new Error("devDispatch help route failed");
}

const schemaBrief = formatSchemaBrief("phase-code");
if (!schemaBrief.includes("task-schema") || !schemaBrief.includes("return: phase-code")) {
  throw new Error("phase-code schema brief is missing expected schemas");
}

const examplePath = join(import.meta.dir, "..", "schemas", "examples", "phase-code.json");
const packet = JSON.parse(readFileSync(examplePath, "utf8"))[0];
const validation = await validateReturn("phase-code", packet);
if (!validation.valid) {
  throw new Error(validation.errors.join("; "));
}

console.log("runtime smoke passed");
