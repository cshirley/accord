import { devRetro } from "@clive.shirley/accord-core/queries/retro.js";

export function runRetroCommand(options: { json?: boolean }): number {
  const result = devRetro();
  if (!result.ok) {
    console.error(result.error);
    return 1;
  }

  if (options.json) {
    console.log(JSON.stringify(result.value, null, 2));
    return 0;
  }

  console.log(result.value.formatted);
  return 0;
}
