import * as fs from "node:fs";
import * as path from "node:path";
import { loadWorkItem } from "../work-items/io.js";

export function checkVerifyStaleness(workItemId: string): { ok: boolean; reason?: string } {
  const baseDir = path.join("docs", "dev", workItemId);
  const wi = loadWorkItem(workItemId);
  // Prefer paths stored on the work item; fall back to conventional layout.
  const specPath = wi?.spec ?? path.join(baseDir, "spec.json");
  const planPath = wi?.plan ?? path.join(baseDir, "plan.json");
  const verifyPath = wi?.verify ?? path.join(baseDir, "verify.json");

  if (!fs.existsSync(specPath)) return { ok: false, reason: `Spec not found: ${specPath}` };
  if (!fs.existsSync(planPath)) return { ok: false, reason: `Plan not found: ${planPath}` };

  if (fs.existsSync(verifyPath)) {
    const verifyMtime = fs.statSync(verifyPath).mtimeMs;
    if (
      fs.statSync(specPath).mtimeMs > verifyMtime ||
      fs.statSync(planPath).mtimeMs > verifyMtime
    ) {
      return {
        ok: false,
        reason: "Verify report is stale — spec or plan modified since last verification",
      };
    }
  }
  return { ok: true };
}
