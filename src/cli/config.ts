import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { getConfigPath, getProjectConfigPath } from "../core/config.js";
import { colors } from "./colors.js";
import { getBooleanFlag, parseArgs } from "./args.js";

/**
 * Schema definition for config values
 */
interface ConfigKeySchema {
  type: "string" | "boolean" | "number";
  enum?: string[];
  description: string;
}

/**
 * All valid config keys and their schemas
 */
const CONFIG_SCHEMA: Record<string, ConfigKeySchema> = {
  "storage.engine": {
    type: "string",
    enum: ["file"],
    description: "Storage engine type",
  },
  "storage.file.path": {
    type: "string",
    description: "Custom storage directory path",
  },
  "storage.file.mode": {
    type: "string",
    enum: ["in-repo", "centralized"],
    description: "Storage mode (in-repo or centralized)",
  },
  "sync.github.enabled": {
    type: "boolean",
    description: "Enable automatic GitHub sync",
  },
  "sync.github.token_env": {
    type: "string",
    description: "Environment variable containing GitHub token",
  },
  "sync.github.label_prefix": {
    type: "string",
    description: "Label prefix for dex tasks in GitHub",
  },
  "sync.github.auto.on_change": {
    type: "boolean",
    description: "Sync immediately on task mutations",
  },
  "sync.github.auto.max_age": {
    type: "string",
    description: "Max age before sync is stale (e.g., 30m, 1h, 1d)",
  },
};

/**
 * Parse and validate a string value into the appropriate type
 */
function parseValue(
  key: string,
  value: string,
  schema: ConfigKeySchema,
): string | boolean | number {
  switch (schema.type) {
    case "boolean":
      if (value === "true" || value === "1" || value === "yes") return true;
      if (value === "false" || value === "0" || value === "no") return false;
      throw new Error(
        `Invalid boolean value: "${value}". Use true/false, 1/0, or yes/no.`,
      );
    case "number": {
      const num = Number(value);
      if (isNaN(num)) throw new Error(`Invalid number value: "${value}"`);
      return num;
    }
    default:
      if (schema.enum && !schema.enum.includes(value)) {
        throw new Error(
          `Invalid value "${value}" for ${key}. Valid options: ${schema.enum.join(", ")}`,
        );
      }
      return value;
  }
}

/**
 * Report an unknown config key error and exit
 */
function exitUnknownKey(key: string): never {
  console.error(
    `${colors.red}Error:${colors.reset} Unknown config key: ${key}`,
  );
  console.error(
    `Run "${colors.dim}dex config --help${colors.reset}" for available keys.`,
  );
  process.exit(1);
}

/**
 * Get a nested value from an object using dot notation
 */
function getNestedValue(obj: any, keyPath: string): unknown {
  const parts = keyPath.split(".");
  let current = obj;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Set a nested value in an object using dot notation
 */
function setNestedValue(obj: any, keyPath: string, value: unknown): void {
  const parts = keyPath.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === undefined) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

/**
 * Delete a nested value from an object using dot notation
 */
function deleteNestedValue(obj: any, keyPath: string): boolean {
  const parts = keyPath.split(".");
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (current[part] === undefined) {
      return false;
    }
    current = current[part];
  }
  const lastPart = parts[parts.length - 1];
  if (current[lastPart] !== undefined) {
    delete current[lastPart];
    return true;
  }
  return false;
}

/**
 * Read and parse a TOML config file
 */
function readConfigFile(configPath: string): Record<string, any> {
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    return parseToml(content) as Record<string, any>;
  } catch (err) {
    throw new Error(`Failed to parse config file at ${configPath}: ${err}`);
  }
}

/**
 * Write a config object to a TOML file
 */
function writeConfigFile(
  configPath: string,
  config: Record<string, any>,
): void {
  // Ensure directory exists
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const content = stringifyToml(config);
  fs.writeFileSync(configPath, content, "utf-8");
}

/**
 * Format a value for display
 */
function formatValue(value: unknown): string {
  if (value === undefined) return `${colors.dim}(not set)${colors.reset}`;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return value;
  return String(value);
}

export interface ConfigCommandOptions {
  storagePath?: string;
}

export async function configCommand(
  args: string[],
  options: ConfigCommandOptions = {},
): Promise<void> {
  const { positional, flags } = parseArgs(
    args,
    {
      global: { short: "g", hasValue: false },
      local: { short: "l", hasValue: false },
      unset: { hasValue: false },
      list: { hasValue: false },
      help: { short: "h", hasValue: false },
    },
    "config",
  );

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex config${colors.reset} - Get and set configuration options

${colors.bold}USAGE:${colors.reset}
  dex config [options] <key>           Get a config value
  dex config [options] <key>=<value>   Set a config value
  dex config [options] --unset <key>   Remove a config value
  dex config --list                    List all config values

${colors.bold}OPTIONS:${colors.reset}
  -g, --global       Use global config (~/.config/dex/dex.toml)
  -l, --local        Use project config (.dex/config.toml)
  --unset            Remove the config key
  --list             List all config values
  -h, --help         Show this help message

${colors.bold}CONFIG KEYS:${colors.reset}
${Object.entries(CONFIG_SCHEMA)
  .map(([key, schema]) => {
    const typeInfo = schema.enum ? schema.enum.join("|") : schema.type;
    return `  ${key.padEnd(30)} ${colors.dim}(${typeInfo})${colors.reset}`;
  })
  .join("\n")}

${colors.bold}EXAMPLES:${colors.reset}
  dex config sync.github.enabled              # Get value
  dex config sync.github.enabled=true         # Set value
  dex config --global sync.github.token_env=GITHUB_TOKEN
  dex config --local sync.github.enabled=true
  dex config --unset sync.github.label_prefix
  dex config --list
`);
    return;
  }

  const useGlobal = getBooleanFlag(flags, "global");
  const useLocal = getBooleanFlag(flags, "local");
  const unset = getBooleanFlag(flags, "unset");
  const listAll = getBooleanFlag(flags, "list");

  // Determine which config file to use
  let configPath: string;
  let configLabel: string;

  if (useGlobal && useLocal) {
    console.error(
      `${colors.red}Error:${colors.reset} Cannot use both --global and --local`,
    );
    process.exit(1);
  }

  if (useLocal) {
    if (!options.storagePath) {
      console.error(
        `${colors.red}Error:${colors.reset} --local requires being in a dex project`,
      );
      console.error(
        `${colors.dim}Run "dex init" to initialize a project or use --global${colors.reset}`,
      );
      process.exit(1);
    }
    const projectPath = getProjectConfigPath();
    if (!projectPath) {
      console.error(
        `${colors.dim}Run "dex init" to initialize a git repository or use --global${colors.reset}`,
      );
      process.exit(1);
    }
    configPath = projectPath;
    configLabel = "local";
  } else {
    // Default to global
    configPath = getConfigPath();
    configLabel = "global";
  }

  // Handle --list
  if (listAll) {
    const globalConfig = readConfigFile(getConfigPath());
    const projectPath = getProjectConfigPath();
    const localConfig = projectPath ? readConfigFile(projectPath) : {};

    console.log(`${colors.bold}Configuration:${colors.reset}`);
    console.log();

    for (const key of Object.keys(CONFIG_SCHEMA)) {
      const globalValue = getNestedValue(globalConfig, key);
      const localValue = getNestedValue(localConfig, key);
      const effectiveValue =
        localValue !== undefined ? localValue : globalValue;

      if (effectiveValue !== undefined) {
        const source =
          localValue !== undefined
            ? colors.cyan + "[local]" + colors.reset
            : colors.dim + "[global]" + colors.reset;
        console.log(`${key} = ${formatValue(effectiveValue)} ${source}`);
      }
    }
    return;
  }

  // Parse the positional argument
  const input = positional[0];

  if (!input && !unset) {
    console.error(`${colors.red}Error:${colors.reset} Missing config key`);
    console.error(`Usage: dex config <key>[=<value>]`);
    console.error(
      `Run "${colors.dim}dex config --help${colors.reset}" for available keys.`,
    );
    process.exit(1);
  }

  // Handle --unset
  if (unset) {
    if (!input) {
      console.error(
        `${colors.red}Error:${colors.reset} --unset requires a key`,
      );
      process.exit(1);
    }
    if (!CONFIG_SCHEMA[input]) {
      exitUnknownKey(input);
    }

    const config = readConfigFile(configPath);
    const deleted = deleteNestedValue(config, input);

    if (deleted) {
      writeConfigFile(configPath, config);
      console.log(
        `${colors.green}Unset${colors.reset} ${input} in ${configLabel} config`,
      );
    } else {
      console.log(
        `${colors.dim}Key ${input} was not set in ${configLabel} config${colors.reset}`,
      );
    }
    return;
  }

  // Check for key=value format
  const equalsIndex = input.indexOf("=");

  if (equalsIndex === -1) {
    // GET operation
    if (!CONFIG_SCHEMA[input]) {
      exitUnknownKey(input);
    }

    // Read from both configs and show effective value
    const globalConfig = readConfigFile(getConfigPath());
    const projectPath = getProjectConfigPath();
    const localConfig = projectPath ? readConfigFile(projectPath) : {};

    const globalValue = getNestedValue(globalConfig, input);
    const localValue = getNestedValue(localConfig, input);
    const effectiveValue = localValue !== undefined ? localValue : globalValue;

    console.log(formatValue(effectiveValue));
  } else {
    // SET operation
    const key = input.slice(0, equalsIndex);
    const rawValue = input.slice(equalsIndex + 1);

    if (!CONFIG_SCHEMA[key]) {
      exitUnknownKey(key);
    }

    try {
      const value = parseValue(key, rawValue, CONFIG_SCHEMA[key]);

      // Check if changing storage mode - warn about potential orphaned tasks
      if (key === "storage.file.mode") {
        const currentConfig = readConfigFile(configPath);
        const currentMode = getNestedValue(currentConfig, key);
        if (currentMode && currentMode !== value) {
          console.log(
            `${colors.yellow}Warning:${colors.reset} Changing storage mode from '${currentMode}' to '${value}'.`,
          );
          console.log(
            `${colors.dim}Existing tasks will NOT be automatically migrated.${colors.reset}`,
          );
          console.log(
            `${colors.dim}Run 'dex doctor --fix' after this change to migrate tasks.${colors.reset}`,
          );
          console.log("");
        }
      }

      const config = readConfigFile(configPath);
      setNestedValue(config, key, value);
      writeConfigFile(configPath, config);

      console.log(
        `${colors.green}Set${colors.reset} ${key} = ${formatValue(value)} in ${configLabel} config`,
      );
    } catch (err) {
      console.error(
        `${colors.red}Error:${colors.reset} ${(err as Error).message}`,
      );
      process.exit(1);
    }
  }
}
