import { type CompletionShell, renderCompletionScript } from "../ui/completion.js";

export function runCompletionCommand(shell: string): number {
  const normalized = shell.trim().toLowerCase();
  if (normalized !== "bash" && normalized !== "zsh") {
    console.error(`Unknown shell "${shell}". Use: accord completion bash|zsh`);
    return 1;
  }
  console.log(renderCompletionScript(normalized as CompletionShell));
  return 0;
}
