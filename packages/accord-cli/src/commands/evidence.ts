import {
  readTimeline,
  renderTimelineMarkdown,
  renderTimelineTsv,
} from "@clive.shirley/accord-core/evidence/timeline.js";

const FORMATS = ["md", "tsv"];

export async function runEvidenceCommand(
  workItemId: string,
  args: string[],
  _options: { json?: boolean },
): Promise<number> {
  let format = "md";
  let task: number | undefined;
  for (let argIndex = 0; argIndex < args.length; argIndex++) {
    const arg = args[argIndex] as string;
    if (arg === "--format") {
      format = args[++argIndex] ?? "";
    } else if (arg.startsWith("--format=")) {
      format = arg.slice("--format=".length);
    } else if (/^task-\d+$/.test(arg)) {
      task = Number(arg.slice("task-".length));
    } else {
      console.error(
        `Unknown evidence argument: ${arg}\nUsage: accord evidence <id> [task-<N>] [--format md|tsv]`,
      );
      return 1;
    }
  }
  if (!FORMATS.includes(format)) {
    console.error(`Unknown evidence format "${format}"; valid formats: ${FORMATS.join(", ")}`);
    return 1;
  }
  const rows = await readTimeline(workItemId, task === undefined ? {} : { task });
  console.log(format === "tsv" ? renderTimelineTsv(rows) : renderTimelineMarkdown(rows));
  return 0;
}
