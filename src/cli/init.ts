import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as readline from "node:readline";
import { getConfigPath } from "../core/config.js";
import { colors, parseArgs, getBooleanFlag } from "./utils.js";

interface ShellConfig {
  name: string;
  configFile: string;
  completionLine: string;
  detectCommand?: string;
}

const SHELLS: ShellConfig[] = [
  {
    name: "bash",
    configFile: path.join(os.homedir(), ".bashrc"),
    completionLine: 'eval "$(dex completion bash)"',
  },
  {
    name: "zsh",
    configFile: path.join(os.homedir(), ".zshrc"),
    completionLine: 'eval "$(dex completion zsh)"',
  },
  {
    name: "fish",
    configFile: path.join(os.homedir(), ".config", "fish", "config.fish"),
    completionLine: "dex completion fish | source",
  },
];

function detectShells(): ShellConfig[] {
  const detected: ShellConfig[] = [];
  for (const shell of SHELLS) {
    if (fs.existsSync(shell.configFile)) {
      detected.push(shell);
    }
  }
  return detected;
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
  const newContent = content.trimEnd() + `\n\n# dex completions\n${shell.completionLine}\n`;

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
  const { flags } = parseArgs(args, {
    yes: { short: "y", hasValue: false },
    help: { short: "h", hasValue: false },
  }, "init");

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex init${colors.reset} - Initialize dex configuration

${colors.bold}USAGE:${colors.reset}
  dex init [options]

${colors.bold}OPTIONS:${colors.reset}
  -y, --yes    Accept all defaults (skip prompts)
  -h, --help   Show this help message

${colors.bold}DESCRIPTION:${colors.reset}
  Creates the dex configuration file and optionally configures
  shell completions for detected shells (bash, zsh, fish).
`);
    return;
  }

  const autoYes = getBooleanFlag(flags, "yes");
  const configPath = getConfigPath();
  const dexConfigDir = path.dirname(configPath);

  // Check if config already exists
  if (fs.existsSync(configPath)) {
    console.error(`${colors.red}Error${colors.reset}: Config file already exists at ${configPath}`);
    console.error(
      `Use ${colors.cyan}dex config edit${colors.reset} to modify it or delete it first.`
    );
    process.exit(1);
  }

  // Create config directory
  fs.mkdirSync(dexConfigDir, { recursive: true });

  // Write default config
  const defaultConfig = `# dex configuration file
# Storage engine: "file", "github-issues", or "github-projects"

[storage]
engine = "file"

# File storage settings (default)
[storage.file]
# path = "~/.dex"  # Uncomment to set custom path

# GitHub Issues storage (alternative)
# [storage]
# engine = "github-issues"
#
# [storage.github-issues]
# owner = "your-username"
# repo = "dex-tasks"
# token_env = "GITHUB_TOKEN"    # Environment variable containing GitHub token
# label_prefix = "dex"           # Prefix for dex-related labels

# GitHub Projects v2 storage (alternative)
# [storage]
# engine = "github-projects"
#
# [storage.github-projects]
# owner = "your-username"
# project_number = 1             # Project number (e.g., #1)
# # OR use project_id directly:
# # project_id = "PVT_kwDOABcD1234"
# token_env = "GITHUB_TOKEN"     # Environment variable containing GitHub token
#
# # Custom field name mappings (must be pre-configured in project)
# [storage.github-projects.field_names]
# status = "Status"
# priority = "Priority"
# result = "Result"
# parent = "Parent ID"
# completed_at = "Completed"
`;

  fs.writeFileSync(configPath, defaultConfig, "utf-8");

  console.log(`${colors.green}✓${colors.reset} Created config file at ${colors.cyan}${configPath}${colors.reset}`);

  // Detect and configure shell completions
  const detectedShells = detectShells();
  const unconfiguredShells = detectedShells.filter((s) => !isCompletionConfigured(s));

  if (unconfiguredShells.length > 0) {
    console.log();
    console.log(`${colors.bold}Shell Completions${colors.reset}`);
    console.log(`Detected shells: ${detectedShells.map((s) => s.name).join(", ")}`);
    console.log();

    for (const shell of unconfiguredShells) {
      const shouldConfigure = autoYes || await promptYesNo(
        `Configure completions for ${colors.cyan}${shell.name}${colors.reset}? [Y/n] `
      );

      if (shouldConfigure) {
        if (configureShellCompletion(shell)) {
          console.log(`${colors.green}✓${colors.reset} Added completions to ${colors.dim}${shell.configFile}${colors.reset}`);
        } else {
          console.log(`${colors.yellow}!${colors.reset} Could not configure ${shell.name} completions`);
        }
      } else {
        console.log(`${colors.dim}Skipped ${shell.name}${colors.reset}`);
      }
    }

    console.log();
    console.log(`${colors.dim}Restart your shell or run 'source <config-file>' to enable completions.${colors.reset}`);
  }

  console.log();
  console.log("Edit the config file to customize your storage engine.");
  console.log(
    `See ${colors.cyan}https://github.com/dcramer/dex${colors.reset} for documentation.`
  );
}
