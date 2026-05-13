import * as fs from "node:fs";
import * as path from "node:path";

export function checkVerifyStaleness(workItemId: string): { ok: boolean; reason?: string } {
  const baseDir = path.join("docs", "dev", workItemId);
  const specPath = path.join(baseDir, "spec.json");
  const planPath = path.join(baseDir, "plan.json");
  const verifyPath = path.join(baseDir, "verify.json");

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
