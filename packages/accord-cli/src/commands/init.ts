import { findGitRoot } from "@clive.shirley/accord-core/config/git.js";
import type { ConfigPlacement } from "@clive.shirley/accord-core/config/init-detect.js";
import { devInitDetect } from "@clive.shirley/accord-core/config/init-detect.js";
import { devInitWrite, type WriteTarget } from "@clive.shirley/accord-core/config/init-write.js";
import type { CliContext } from "../context.js";
import { cliNotify } from "../notify.js";

export type InitCommandOptions = {
  json?: boolean;
  write?: boolean;
  target?: WriteTarget;
};

export function defaultInitWriteTarget(placement: ConfigPlacement): WriteTarget {
  switch (placement.type) {
    case "at_root":
      return "local";
    case "root_exists":
      return "link_only";
    case "root_no_config":
    case "root_no_agents":
      return "root";
    default:
      return "local";
  }
}

export function runInitCommand(ctx: CliContext, options: InitCommandOptions): number {
  const detect = devInitDetect(ctx.cwd);
  if (!detect.ok) {
    if (options.json) {
      console.log(JSON.stringify({ ok: false, error: detect.error }, null, 2));
    } else {
      cliNotify("error", detect.error.formatted_summary);
    }
    return 1;
  }

  if (!options.write) {
    if (options.json) {
      console.log(JSON.stringify({ ok: true, ...detect.value }, null, 2));
      return 0;
    }
    console.log(detect.value.formatted_summary);
    cliNotify("info", "Run `accord init --write` to persist config (or pass --target).");
    return 0;
  }

  const target = options.target ?? defaultInitWriteTarget(detect.value.placement);
  const gitRoot = detect.value.placement.git_root ?? findGitRoot(ctx.cwd) ?? undefined;

  try {
    const write = devInitWrite({
      config: detect.value.proposed_config,
      target,
      cwd: ctx.cwd,
      git_root: gitRoot,
    });

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            ok: true,
            detect: detect.value,
            write,
            target,
          },
          null,
          2,
        ),
      );
      return 0;
    }

    console.log(detect.value.formatted_summary);
    cliNotify("info", write.summary);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (options.json) {
      console.log(JSON.stringify({ ok: false, error: message }, null, 2));
    } else {
      cliNotify("error", message);
    }
    return 1;
  }
}
