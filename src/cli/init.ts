import * as fs from "node:fs";
import * as path from "node:path";
import { getConfigPath } from "../core/config.js";
import { colors } from "./utils.js";

export function initCommand(): void {
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
  console.log();
  console.log("Edit the file to configure your storage engine.");
  console.log(
    `See ${colors.cyan}https://github.com/zeeg/dex${colors.reset} for documentation.`
  );
}
