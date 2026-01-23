import { colors, parseArgs, getBooleanFlag } from "./utils.js";
import { generateBashCompletion } from "./completion/bash.js";
import { generateZshCompletion } from "./completion/zsh.js";
import { generateFishCompletion } from "./completion/fish.js";

const SHELL_GENERATORS = {
  bash: generateBashCompletion,
  zsh: generateZshCompletion,
  fish: generateFishCompletion,
} as const;

type Shell = keyof typeof SHELL_GENERATORS;

function isValidShell(shell: string): shell is Shell {
  return shell in SHELL_GENERATORS;
}

export function completionCommand(args: string[]): void {
  const { positional, flags } = parseArgs(args, {
    help: { short: "h", hasValue: false },
  }, "completion");

  if (getBooleanFlag(flags, "help") || !positional[0]) {
    printHelp();
    return;
  }

  const shell = positional[0];

  if (!isValidShell(shell)) {
    console.error(`${colors.red}Error:${colors.reset} Unsupported shell: ${shell}`);
    console.error(`Supported shells: ${Object.keys(SHELL_GENERATORS).join(", ")}`);
    process.exit(1);
  }

  console.log(SHELL_GENERATORS[shell]());
}

function printHelp(): void {
  console.log(`${colors.bold}dex completion${colors.reset} - Generate shell completion scripts

${colors.bold}USAGE:${colors.reset}
  dex completion <shell>

${colors.bold}SUPPORTED SHELLS:${colors.reset}
  bash    Bash shell completion
  zsh     Zsh shell completion
  fish    Fish shell completion

${colors.bold}INSTALLATION:${colors.reset}

  ${colors.bold}Bash:${colors.reset}
    ${colors.dim}# Add to ~/.bashrc:${colors.reset}
    eval "$(dex completion bash)"

    ${colors.dim}# Or source directly:${colors.reset}
    source <(dex completion bash)

  ${colors.bold}Zsh:${colors.reset}
    ${colors.dim}# Add to ~/.zshrc (after compinit):${colors.reset}
    eval "$(dex completion zsh)"

    ${colors.dim}# Or source directly:${colors.reset}
    source <(dex completion zsh)

  ${colors.bold}Fish:${colors.reset}
    ${colors.dim}# Add to ~/.config/fish/config.fish:${colors.reset}
    dex completion fish | source

    ${colors.dim}# Or save to completions directory:${colors.reset}
    dex completion fish > ~/.config/fish/completions/dex.fish

${colors.bold}OPTIONS:${colors.reset}
  -h, --help    Show this help message
`);
}
