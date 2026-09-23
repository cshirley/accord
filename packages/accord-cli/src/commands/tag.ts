import { parseHarnessTagArgs } from "@clive.shirley/accord-core/commands/dispatch.js";
import {
  clearHarnessRunTag,
  describeHarnessRunMeta,
  setHarnessRunTag,
} from "@clive.shirley/accord-core/telemetry/usage.js";

export function runTagCommand(rawArgs: string, options: { json?: boolean }): number {
  const parsed = parseHarnessTagArgs(rawArgs);

  if (parsed.mode === "show") {
    const text = describeHarnessRunMeta();
    if (options.json) {
      console.log(JSON.stringify({ mode: "show", message: text }, null, 2));
      return 0;
    }
    console.log(text);
    return 0;
  }

  if (parsed.mode === "clear") {
    clearHarnessRunTag();
    if (options.json) {
      console.log(JSON.stringify({ mode: "clear", cleared: true }, null, 2));
      return 0;
    }
    console.log("ACCORD run tag cleared (.tasks/.harness-run.json removed).");
    return 0;
  }

  if (!parsed.label.trim()) {
    console.error("Usage: accord tag <label> | accord tag --new <label> | accord tag --clear");
    return 1;
  }

  try {
    const meta = setHarnessRunTag(parsed.label, { newRunId: parsed.newRunId });
    if (options.json) {
      console.log(JSON.stringify({ mode: "set", ...meta }, null, 2));
      return 0;
    }
    const hint = parsed.newRunId ? "(new run_id) " : "";
    console.log(
      `ACCORD run ${hint}tag: ${meta.tag}\nrun_id: ${meta.run_id}\n\nUsage rows in .tasks/*-usage.jsonl include harness_run_id / harness_session_tag.`,
    );
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
