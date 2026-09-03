import { DEV_HELP_TEXT } from "@clive.shirley/accord-core/commands/help.js";

/** Full harness help — same content as `/dev help`, adapted for standalone CLI. */
export function accordHelpText(): string {
  return DEV_HELP_TEXT.replaceAll("/dev", "accord");
}

export function runDevHelpCommand(options: { json?: boolean }): number {
  const text = accordHelpText();
  if (options.json) {
    console.log(JSON.stringify({ help: text }, null, 2));
    return 0;
  }
  console.log(text);
  return 0;
}
