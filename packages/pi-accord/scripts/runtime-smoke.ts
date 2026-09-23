import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateReturn } from "@clive.shirley/accord-core/artifacts/validation.js";
import { devDispatch } from "@clive.shirley/accord-core/commands/dispatch.js";
import { formatSchemaBrief } from "@clive.shirley/accord-core/verification/runner.js";

const route = devDispatch("help");
if (route.type !== "known" || route.subcommand !== "help") {
  throw new Error("devDispatch help route failed");
}

const schemaBrief = formatSchemaBrief("phase-code");
if (!schemaBrief.includes("task-schema") || !schemaBrief.includes("return: phase-code")) {
  throw new Error("phase-code schema brief is missing expected schemas");
}

const coreRoot = join(import.meta.dir, "..", "..", "accord-core");
const examplePath = join(coreRoot, "schemas", "examples", "phase-code.json");
const packet = JSON.parse(readFileSync(examplePath, "utf8"))[0];
const validation = await validateReturn("phase-code", packet);
if (!validation.valid) {
  throw new Error(validation.errors.join("; "));
}

console.log("runtime smoke passed");
