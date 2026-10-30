import { DEV_WORK_ITEM_ID_PATTERN } from "@clive.shirley/accord-core/commands/dispatch.js";
import {
  bootstrapWorkItem,
  WORK_ITEM_PATTERNS,
  WORK_ITEM_VARIANTS,
} from "@clive.shirley/accord-core/work-items/bootstrap.js";

export type BootstrapArgs = {
  /** Explicit work item id, or undefined with `adhoc` to generate `ADHOC-<YYYYMMDD><NN>`. */
  workItemId?: string;
  adhoc: boolean;
  title: string;
  pattern: string;
  variant: string;
};

export type BootstrapParse = { ok: true; args: BootstrapArgs } | { ok: false; message: string };

const TERMINATOR_HINT = "Put a title word that starts with -- after a bare `--`.";

/**
 * Parse tokens after `bootstrap`: `<ID> <title…>` or `--adhoc <title…>`, plus `--pattern` and
 * `--variant`. Tokens after a bare `--` are title text, so a title word may start with `--`
 * (global flags such as `--json` are also title text there).
 */
export function parseBootstrapArgs(tail: string[]): BootstrapParse {
  let pattern = "implement";
  let variant = "standard";
  let adhoc = false;
  const positional: string[] = [];

  for (let index = 0; index < tail.length; index++) {
    const token = tail[index];
    if (token === "--") {
      positional.push(...tail.slice(index + 1));
      break;
    }
    if (token === "--adhoc") {
      adhoc = true;
    } else if (token === "--pattern" || token === "--variant") {
      const value = tail[++index];
      if (!value) return { ok: false, message: `${token} requires a value` };
      if (token === "--pattern") pattern = value;
      else variant = value;
    } else if (token.startsWith("--pattern=")) {
      pattern = token.slice("--pattern=".length);
    } else if (token.startsWith("--variant=")) {
      variant = token.slice("--variant=".length);
    } else if (token.startsWith("--")) {
      return { ok: false, message: `Unknown bootstrap flag: ${token}. ${TERMINATOR_HINT}` };
    } else {
      positional.push(token);
    }
  }

  if (!(WORK_ITEM_PATTERNS as readonly string[]).includes(pattern)) {
    return { ok: false, message: `--pattern must be one of: ${WORK_ITEM_PATTERNS.join(", ")}` };
  }
  if (!(WORK_ITEM_VARIANTS as readonly string[]).includes(variant)) {
    return { ok: false, message: `--variant must be one of: ${WORK_ITEM_VARIANTS.join(", ")}` };
  }

  if (adhoc) {
    if (positional.length > 0 && DEV_WORK_ITEM_ID_PATTERN.test(positional[0])) {
      return {
        ok: false,
        message: `bootstrap --adhoc generates the id; "${positional[0]}" looks like a ticket id. Use: bootstrap ${positional[0]} <title>`,
      };
    }
    const title = positional.join(" ").trim();
    if (!title) return { ok: false, message: "bootstrap --adhoc requires a title" };
    return { ok: true, args: { adhoc, title, pattern, variant } };
  }

  const [workItemId, ...titleParts] = positional;
  const title = titleParts.join(" ").trim();
  if (!workItemId || !title) {
    return { ok: false, message: "bootstrap requires <ID> <title> (or --adhoc <title>)" };
  }
  return { ok: true, args: { workItemId, adhoc, title, pattern, variant } };
}

/** Thin adapter: call the core bootstrap and print the result. */
export function runBootstrapCommand(args: BootstrapArgs, options: { json?: boolean }): number {
  const result = bootstrapWorkItem({
    id: args.workItemId,
    adhoc: args.adhoc,
    title: args.title,
    pattern: args.pattern,
    variant: args.variant,
  });
  if (!result.ok) {
    console.error(result.error);
    return 1;
  }
  const { id, path, work_item: workItem, next } = result.value;

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          id,
          title: workItem.title,
          pattern: workItem.pattern,
          variant: workItem.variant ?? null,
          phase: workItem.phase,
          path,
          next,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  console.log(`Created work item ${id} (${args.pattern}/${args.variant}) at ${path}`);
  console.log(`Next: ${next}`);
  return 0;
}
