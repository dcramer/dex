import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as readline from "node:readline";
import { getConfigPath } from "../core/config.js";
import { colors } from "./colors.js";
import { getBooleanFlag, parseArgs } from "./args.js";

interface ShellConfig {
  name: string;
  configFile: string;
  completionLine: string;
  detectCommand?: string;
}

function getShellConfigs(): ShellConfig[] {
  const home = os.homedir();
  return [
    {
      name: "bash",
      configFile: path.join(home, ".bashrc"),
      completionLine: 'eval "$(dex completion bash)"',
    },
    {
      name: "zsh",
      configFile: path.join(home, ".zshrc"),
      completionLine: 'eval "$(dex completion zsh)"',
    },
    {
      name: "fish",
      configFile: path.join(home, ".config", "fish", "config.fish"),
      completionLine: "dex completion fish | source",
    },
  ];
}

function detectShells(): ShellConfig[] {
  return getShellConfigs().filter((shell) => fs.existsSync(shell.configFile));
}

function isCompletionConfigured(shell: ShellConfig): boolean {
  if (!fs.existsSync(shell.configFile)) return false;
  const content = fs.readFileSync(shell.configFile, "utf-8");
  return content.includes("dex completion");
}

function configureShellCompletion(shell: ShellConfig): boolean {
  if (!fs.existsSync(shell.configFile)) return false;

  const content = fs.readFileSync(shell.configFile, "utf-8");

  // Always append at end - ensures PATH is set up and dex is available
  const newContent =
    content.trimEnd() + `\n\n# dex completions\n${shell.completionLine}\n`;

  fs.writeFileSync(shell.configFile, newContent, "utf-8");
  return true;
}

async function promptYesNo(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      const normalized = answer.toLowerCase().trim();
      resolve(normalized === "y" || normalized === "yes" || normalized === "");
    });
  });
}

export async function initCommand(args: string[]): Promise<void> {
  const { flags } = parseArgs(
    args,
    {
      yes: { short: "y", hasValue: false },
      help: { short: "h", hasValue: false },
      "config-dir": { hasValue: true },
    },
    "init",
  );

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex init${colors.reset} - Initialize dex configuration

${colors.bold}USAGE:${colors.reset}
  dex init [options]

${colors.bold}OPTIONS:${colors.reset}
  -y, --yes           Accept all defaults (skip prompts)
  --config-dir PATH   Override config directory (default: ~/.config/dex)
  -h, --help          Show this help message

${colors.bold}DESCRIPTION:${colors.reset}
  Creates the dex configuration file and optionally configures
  shell completions for detected shells (bash, zsh, fish).
`);
    return;
  }

  const autoYes = getBooleanFlag(flags, "yes");
  const configDir = flags["config-dir"] as string | undefined;
  const configPath = configDir
    ? path.join(configDir, "dex.toml")
    : getConfigPath();
  const dexConfigDir = path.dirname(configPath);

  // Check if config already exists
  if (fs.existsSync(configPath)) {
    console.error(
      `${colors.red}Error${colors.reset}: Config file already exists at ${configPath}`,
    );
    console.error(`Edit the file directly or delete it to reinitialize.`);
    process.exit(1);
  }

  // Create config directory
  fs.mkdirSync(dexConfigDir, { recursive: true });

  // Write default config
  const defaultConfig = `# dex configuration file

[storage]
engine = "file"

# File storage settings
[storage.file]
# path = "/custom/path"  # Uncomment to set custom storage path

# GitHub sync (optional - sync tasks with GitHub Issues)
# Note: owner/repo are automatically inferred from your git remote
# [sync.github]
# enabled = true
# token_env = "GITHUB_TOKEN"    # Environment variable containing GitHub token (or use gh CLI)
# label_prefix = "dex"           # Prefix for dex-related labels
`;

  fs.writeFileSync(configPath, defaultConfig, "utf-8");

  console.log(
    `${colors.green}✓${colors.reset} Created config file at ${colors.cyan}${configPath}${colors.reset}`,
  );

  // Detect and configure shell completions
  const detectedShells = detectShells();
  const unconfiguredShells = detectedShells.filter(
    (s) => !isCompletionConfigured(s),
  );

  if (unconfiguredShells.length > 0) {
    console.log();
    console.log(`${colors.bold}Shell Completions${colors.reset}`);
    console.log(
      `Detected shells: ${detectedShells.map((s) => s.name).join(", ")}`,
    );
    console.log();

    for (const shell of unconfiguredShells) {
      const shouldConfigure =
        autoYes ||
        (await promptYesNo(
          `Configure completions for ${colors.cyan}${shell.name}${colors.reset}? [Y/n] `,
        ));

      if (shouldConfigure) {
        if (configureShellCompletion(shell)) {
          console.log(
            `${colors.green}✓${colors.reset} Added completions to ${colors.dim}${shell.configFile}${colors.reset}`,
          );
        } else {
          console.log(
            `${colors.yellow}!${colors.reset} Could not configure ${shell.name} completions`,
          );
        }
      } else {
        console.log(`${colors.dim}Skipped ${shell.name}${colors.reset}`);
      }
    }

    console.log();
    console.log(
      `${colors.dim}Restart your shell or run 'source <config-file>' to enable completions.${colors.reset}`,
    );
  }

  console.log();
  console.log("Edit the config file to customize your storage engine.");
  console.log(
    `See ${colors.cyan}https://github.com/dcramer/dex${colors.reset} for documentation.`,
  );
}
