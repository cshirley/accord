import { appendFileSync } from "node:fs";
import { detectPr0Trigger } from "./trigger.js";

const result = detectPr0Trigger({
  repoRoot: process.env.GITHUB_WORKSPACE || process.cwd(),
  branch: process.env.GITHUB_REF_NAME ?? "",
  baseRef: process.env.ACCORD_CI_BASE_REF || "main",
});
if (result.trigger && process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, "run=true\n");
}
console.log(
  result.trigger ? "accord-driven: PR0 trigger" : `accord-driven: skipped (${result.reason})`,
);
