/**
 * Shell completion script generators.
 */

import { allCommandNames, WORK_ITEM_ACTIONS } from "./command-catalog.js";
import { WORKFLOW_SUBCOMMANDS } from "../commands/workflow.js";

export type CompletionShell = "bash" | "zsh";

export function renderCompletionScript(shell: CompletionShell): string {
  if (shell === "zsh") return renderZshCompletion();
  return renderBashCompletion();
}

function renderBashCompletion(): string {
  const commands = allCommandNames().join(" ");
  const workflow = WORKFLOW_SUBCOMMANDS.join(" ");
  const actions = WORK_ITEM_ACTIONS.join(" ");
  return `# bash completion for accord
_accord_completion() {
  local cur prev words cword
  _init_completion || return

  local commands="${commands}"
  local workflow="${workflow}"
  local actions="${actions}"
  local plan_sub="resume finish"

  if (( cword == 1 )); then
    COMPREPLY=( $(compgen -W "$commands" -- "$cur") )
    return
  fi

  case "\${words[1]}" in
    plan)
      if (( cword == 2 )); then
        COMPREPLY=( $(compgen -W "$plan_sub" -- "$cur") )
      else
        COMPREPLY=( $(compgen -f -- "$cur") )
      fi
      ;;
    resume|finish|drive|align|spec|check|gaps|deviations|rehydrate|spec-gaps)
      COMPREPLY=( $(compgen -f -- "$cur") )
      ;;
    completion)
      COMPREPLY=( $(compgen -W "bash zsh" -- "$cur") )
      ;;
    config)
      COMPREPLY=( $(compgen -W "init" -- "$cur") )
      ;;
    *)
      COMPREPLY=( $(compgen -f -- "$cur") )
      ;;
  esac
}

complete -F _accord_completion accord
`;
}

function renderZshCompletion(): string {
  const commands = allCommandNames();
  const lines = [
    "#compdef accord",
    "",
    "_accord() {",
    "  local context state line",
    "  typeset -A opt_args",
    "",
    "  _arguments -C \\",
    "    '1:command:->command' \\",
    "    '*::arg:->args'",
    "",
    "  case $state in",
    "    command)",
    `      _values 'accord command' ${commands.map((command) => `'${command}'`).join(" ")}`,
    "      ;;",
    "    args)",
    "      case $words[1] in",
    "        plan)",
    "          if (( CURRENT == 2 )); then",
    "            _values 'plan mode' resume finish",
    "          else",
    "            _files",
    "          fi",
    "          ;;",
    "        resume|finish|drive|align|spec|check|gaps|deviations|rehydrate|spec-gaps)",
    "          _files",
    "          ;;",
    "        completion)",
    "          _values 'shell' bash zsh",
    "          ;;",
    "        config)",
    "          _values 'config command' init",
    "          ;;",
    "        *)",
    "          _files",
    "          ;;",
    "      esac",
    "      ;;",
    "  esac",
    "}",
    "",
    "_accord",
  ];
  return lines.join("\n");
}
