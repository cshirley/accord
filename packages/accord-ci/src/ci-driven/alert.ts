import { spawn } from "node:child_process";
import type { Logger } from "../../../accord-core/src/logging.js";
import { emitStackEvent } from "../../../accord-core/src/telemetry/stack-events.js";
import { MissingSecretError } from "../lib/env.js";
import type { Pr0ExecLike as ExecLike } from "./pr0.js";
import { CI_PUSH_TOKEN_NAME } from "./startup.js";

export interface RaiseAlertOpts {
  readonly workItemId: string;
  readonly condition: string;
  /** null/undefined: no work item PR was found; only the log event is emitted. */
  readonly prNumber?: number | null;
  readonly dryRun?: boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly exec?: ExecLike;
  readonly logger?: Logger;
  readonly detail?: string;
  readonly cwd?: string;
}

export const spawnExec: ExecLike = (cmd, args, opts) =>
  new Promise((resolve, reject) => {
    const child = spawn(cmd, [...args], {
      cwd: opts?.cwd,
      env: { ...process.env, ...opts?.env } as NodeJS.ProcessEnv,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
  });

/** Emit stack.ci.alert at error and post one PR comment through gh with the push token. */
export async function raiseAlert(opts: RaiseAlertOpts): Promise<void> {
  emitStackEvent(
    "stack.ci.alert",
    { work_item_id: opts.workItemId, condition: opts.condition },
    opts.logger,
  );
  if (opts.dryRun || opts.prNumber === null || opts.prNumber === undefined) return;

  const token = (opts.env ?? process.env)[CI_PUSH_TOKEN_NAME];
  if (token === undefined || token === "") throw new MissingSecretError(CI_PUSH_TOKEN_NAME);

  const body = [
    `**ACCORD CI alert** for \`${opts.workItemId}\`: \`${opts.condition}\``,
    ...(opts.detail ? ["", opts.detail] : []),
  ].join("\n");
  const exec = opts.exec ?? spawnExec;
  const result = await exec("gh", ["pr", "comment", String(opts.prNumber), "--body", body], {
    cwd: opts.cwd,
    env: { GH_TOKEN: token },
  });
  if (result.exitCode !== 0) {
    throw new Error(`gh pr comment failed for PR ${opts.prNumber} (exit ${result.exitCode})`);
  }
}
