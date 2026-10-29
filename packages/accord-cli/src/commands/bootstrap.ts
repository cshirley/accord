import fs from "node:fs";
import path from "node:path";
import { DEV_WORK_ITEM_ID_PATTERN } from "@clive.shirley/accord-core/commands/dispatch.js";
import { loadWorkItem } from "@clive.shirley/accord-core/work-items/io.js";
import { devBootstrap } from "@clive.shirley/accord-core/work-items/lifecycle.js";
import { nextSyntheticWorkItemId } from "@clive.shirley/accord-core/work-items/synthetic.js";

const PATTERNS = ["implement", "quick_fix", "investigate", "infra", "analyse"] as const;
const VARIANTS = ["express", "standard", "orchestrated"] as const;

type Pattern = (typeof PATTERNS)[number];
type Variant = (typeof VARIANTS)[number];

export type BootstrapArgs = {
  /** Explicit work item id, or undefined with `adhoc` to generate `ADHOC-<YYYYMMDD><NN>`. */
  workItemId?: string;
  adhoc: boolean;
  title: string;
  pattern: string;
  variant: string;
};

export type BootstrapParse = { ok: true; args: BootstrapArgs } | { ok: false; message: string };

/** Parse tokens after `bootstrap`: `<ID> <title…>` or `--adhoc <title…>`, plus `--pattern`/`--variant`. */
export function parseBootstrapArgs(tail: string[]): BootstrapParse {
  let pattern = "implement";
  let variant = "standard";
  let adhoc = false;
  const positional: string[] = [];

  for (let index = 0; index < tail.length; index++) {
    const token = tail[index];
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
      return { ok: false, message: `Unknown bootstrap flag: ${token}` };
    } else {
      positional.push(token);
    }
  }

  if (!PATTERNS.includes(pattern as Pattern)) {
    return { ok: false, message: `--pattern must be one of: ${PATTERNS.join(", ")}` };
  }
  if (!VARIANTS.includes(variant as Variant)) {
    return { ok: false, message: `--variant must be one of: ${VARIANTS.join(", ")}` };
  }

  if (adhoc) {
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

function idTaken(id: string): boolean {
  return loadWorkItem(id) !== null || fs.existsSync(path.join("docs", "dev", id));
}

export function runBootstrapCommand(args: BootstrapArgs, options: { json?: boolean }): number {
  if (DEV_WORK_ITEM_ID_PATTERN.test(args.title)) {
    console.error(
      "bootstrap: title must describe the work, not be a ticket id. A ticket-shaped title makes align look it up in the tracker.",
    );
    return 1;
  }

  let id: string;
  try {
    id = args.workItemId ?? nextSyntheticWorkItemId(idTaken);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  if (!DEV_WORK_ITEM_ID_PATTERN.test(id)) {
    console.error(`bootstrap: "${id}" is not a work item id (expected e.g. ACCORD-1234).`);
    return 1;
  }
  if (idTaken(id)) {
    console.error(`bootstrap: work item ${id} already exists. Use: accord resume ${id}`);
    return 1;
  }

  const boot = devBootstrap(id, args.title, args.pattern as Pattern, args.variant, {
    expected_finish: args.title.slice(0, 240),
  });
  const next = `accord align ${id}`;

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          id,
          title: args.title,
          pattern: boot.work_item.pattern,
          variant: boot.work_item.variant ?? null,
          phase: boot.work_item.phase,
          path: boot.path,
          next,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  console.log(`Created work item ${id} (${args.pattern}/${args.variant}) at ${boot.path}`);
  console.log(`Next: ${next}`);
  return 0;
}
