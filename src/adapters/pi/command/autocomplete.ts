import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from "@mariozechner/pi-tui";
import { DEV_SUBCOMMANDS } from "../../../core/commands/dispatch.js";
import { TASKS_DIR, listWorkItemFiles, readJson } from "../../../core/work-items/io.js";
import type { WorkItem } from "../../../core/work-items/types.js";

export const WORK_ITEM_ID_SUBCOMMANDS = new Set([
  "align",
  "spec",
  "plan",
  "resume",
  "finish",
  "check",
  "gaps",
  "deviations",
  "amend-spec",
  "spec-gaps",
]);

const DEVIATION_ACTIONS: AutocompleteItem[] = [
  { value: "accept", label: "accept", description: "Accept a deviation and record plan guidance" },
  { value: "revert", label: "revert", description: "Reject a deviation and return to plan-conformant work" },
];

function getWorkItemCompletions(subcommand: string, query: string): AutocompleteItem[] | null {
  const q = query.toLowerCase();
  const items = listWorkItemFiles()
    .map((file) => readJson<WorkItem>(`${TASKS_DIR}/${file}`))
    .filter((wi): wi is WorkItem => wi !== null)
    .filter((wi) => {
      const haystack = `${wi.id} ${wi.title} ${wi.phase}`.toLowerCase();
      return haystack.includes(q);
    })
    .sort((a, b) => b.updated.localeCompare(a.updated))
    .map((wi) => ({
      value: subcommand === "deviations" ? `${subcommand} ${wi.id} ` : `${subcommand} ${wi.id}`,
      label: wi.id,
      description: `${wi.title} (phase: ${wi.phase})`,
    }));

  return items.length > 0 ? items : null;
}

function getDeviationActionCompletions(workItemId: string, query: string): AutocompleteItem[] | null {
  const q = query.toLowerCase();
  const items = DEVIATION_ACTIONS
    .filter((action) => action.value.startsWith(q))
    .map((action) => ({
      ...action,
      value: `deviations ${workItemId} ${action.value} `,
    }));

  return items.length > 0 ? items : null;
}

function getDeviationTaskCompletions(
  workItemId: string,
  action: string,
  query: string,
): AutocompleteItem[] | null {
  const wi = readJson<WorkItem>(`${TASKS_DIR}/${workItemId}.json`);
  if (!wi) return null;

  const q = query.toLowerCase();
  const deviations = (wi.deviations || []).filter((deviation) => {
    const haystack = `task-${deviation.task_id} ${deviation.task_id} ${deviation.description || ""}`.toLowerCase();
    return haystack.includes(q);
  });

  const items = deviations
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((deviation) => ({
      value: `deviations ${workItemId} ${action} ${deviation.task_id}`,
      label: String(deviation.task_id),
      description: deviation.description || `task-${deviation.task_id}`,
    }));

  return items.length > 0 ? items : null;
}

export function getDevArgumentCompletions(prefix: string): AutocompleteItem[] | null {
  const input = prefix.trimStart();
  const hasTrailingSpace = /\s$/.test(input);
  const words = input.trimEnd().split(/\s+/).filter(Boolean);
  const subcommand = words[0]?.toLowerCase() ?? "";

  if (subcommand === "deviations") {
    const workItemId = words[1] ?? "";
    const action = words[2]?.toLowerCase() ?? "";

    if (words.length === 2 && hasTrailingSpace) return getDeviationActionCompletions(workItemId, "");
    if (words.length === 3 && !hasTrailingSpace) return getDeviationActionCompletions(workItemId, action);
    if (words.length === 3 && hasTrailingSpace && DEVIATION_ACTIONS.some((a) => a.value === action)) {
      return getDeviationTaskCompletions(workItemId, action, "");
    }
    if (words.length === 4 && !hasTrailingSpace && DEVIATION_ACTIONS.some((a) => a.value === action)) {
      return getDeviationTaskCompletions(workItemId, action, words[3] ?? "");
    }
  }

  if (WORK_ITEM_ID_SUBCOMMANDS.has(subcommand)) {
    if (words.length === 1 && hasTrailingSpace) return getWorkItemCompletions(subcommand, "");
    if (words.length === 2 && !hasTrailingSpace) return getWorkItemCompletions(subcommand, words[1] ?? "");
  }

  if (words.length > 1 || hasTrailingSpace) {
    return null;
  }

  const filtered = DEV_SUBCOMMANDS
    .map((s) => ({
      value: WORK_ITEM_ID_SUBCOMMANDS.has(s.value) ? `${s.value} ` : s.value,
      label: s.value,
      description: s.description,
    }))
    .filter((i) => i.value.startsWith(prefix));
  return filtered.length > 0 ? filtered : null;
}

function getDevArgumentPrefix(lines: string[], cursorLine: number, cursorCol: number): string | null {
  const currentLine = lines[cursorLine] || "";
  const textBeforeCursor = currentLine.slice(0, cursorCol);
  const match = textBeforeCursor.match(/^\/(dev|accord)\s+(.*)$/);
  return match ? (match[2] ?? "") : null;
}

export function wrapDevAutocomplete(current: AutocompleteProvider): AutocompleteProvider {
  return {
    async getSuggestions(lines, cursorLine, cursorCol, options): Promise<AutocompleteSuggestions | null> {
      const devPrefix = getDevArgumentPrefix(lines, cursorLine, cursorCol);
      if (devPrefix !== null) {
        const items = getDevArgumentCompletions(devPrefix);
        if (items?.length) return { items, prefix: devPrefix };
      }
      return current.getSuggestions(lines, cursorLine, cursorCol, options);
    },
    applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
      return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
    },
    shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
      if (getDevArgumentPrefix(lines, cursorLine, cursorCol) !== null) return true;
      return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
    },
  };
}
