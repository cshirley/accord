import { loadDevHarnessConfig } from "@clive.shirley/accord-core/config/agents-md.js";
import {
  stackReport,
  stackShow,
  stackSubmit,
  stackSync,
} from "@clive.shirley/accord-core/stack/service.js";

const VERBS = {
  show: stackShow,
  sync: stackSync,
  submit: stackSubmit,
  report: stackReport,
};

export async function runStackCommand(
  verb: keyof typeof VERBS,
  workItemId: string,
  cwd: string,
): Promise<number> {
  const result = await VERBS[verb](workItemId, loadDevHarnessConfig(cwd), { cwd });
  console.log(result.text);
  return result.ok ? 0 : 1;
}
