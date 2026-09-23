/**
 * Readline tab completion for accord commands and work item ids.
 */

import type { Completer } from "node:readline";
import {
  allCommandNames,
  commandNeedsWorkItem,
  matchCommands,
  matchWorkItems,
} from "./command-catalog.js";

export type AccordCompleterContext = {
  workItemIds: () => string[];
};

export function createAccordCompleter(ctx: AccordCompleterContext): Completer {
  return (line: string): [string[], string] => {
    const trimmed = line.trimStart();
    const leading = line.slice(0, line.length - trimmed.length);
    const tokens = trimmed.length > 0 ? trimmed.split(/\s+/) : [];
    const endsWithSpace = /\s$/.test(line);

    if (tokens.length === 0) {
      const matches = matchCommands("");
      return [matches, leading];
    }

    if (tokens.length === 1 && !endsWithSpace) {
      const matches = matchCommands(tokens[0] ?? "");
      const suffix = matches.length === 1 ? " " : "";
      return [matches.map((match) => `${leading}${match}${suffix}`), ""];
    }

    const command = tokens[0] ?? "";
    const partial = endsWithSpace ? "" : (tokens.at(-1) ?? "");
    const ids = ctx.workItemIds();

    if (command === "plan") {
      const subcommands = ["resume", "finish"].filter((name) => name.startsWith(partial));
      if (tokens.length === 2 && !endsWithSpace && subcommands.length > 0) {
        return [subcommands.map((name) => `${leading}${command} ${name} `), ""];
      }
      const matches = matchWorkItems(partial, ids);
      const prefix = `${leading}${tokens.slice(0, -1).join(" ")} `;
      return [matches.map((id) => `${prefix}${id}`), ""];
    }

    if (commandNeedsWorkItem(command) || ["drive", "gaps", "deviations", "rehydrate", "spec-gaps"].includes(command)) {
      const matches = matchWorkItems(partial, ids);
      const prefix = tokens.length <= 1 ? `${leading}${command} ` : `${leading}${tokens.slice(0, -1).join(" ")} `;
      return [matches.map((id) => `${prefix}${id}`), ""];
    }

    if (tokens.length === 1) {
      const matches = matchCommands(partial);
      return [matches.map((name) => `${leading}${name} `), ""];
    }

    return [[...allCommandNames()], leading];
  };
}
