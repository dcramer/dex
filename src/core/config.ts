import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parse as parseToml } from "smol-toml";

/**
 * Storage engine configuration
 */
export interface StorageConfig {
  /** Storage engine type */
  engine: "file" | "github-issues" | "github-projects";

  /** File storage settings */
  file?: {
    /** Path to storage directory */
    path?: string;
  };

  /** GitHub Issues storage settings */
  "github-issues"?: {
    /** Repository owner */
    owner: string;
    /** Repository name */
    repo: string;
    /** Environment variable containing GitHub token */
    token_env?: string;
    /** Label prefix for dex tasks */
    label_prefix?: string;
  };

  /** GitHub Projects v2 storage settings */
  "github-projects"?: {
    /** Repository/organization owner */
    owner: string;
    /** Project number (e.g., #3) */
    project_number?: number;
    /** Project ID (alternative to project_number) */
    project_id?: string;
    /** Environment variable containing GitHub token */
    token_env?: string;
    /** Custom field name mappings */
    field_names?: {
      status?: string;
      priority?: string;
      result?: string;
      parent?: string;
      completed_at?: string;
    };
  };
}

/**
 * Dex configuration
 */
export interface Config {
  /** Storage configuration */
  storage: StorageConfig;
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Config = {
  storage: {
    engine: "file",
    file: {
      path: undefined, // Will use auto-detected path
    },
  },
};

/**
 * Get the config file path
 * @returns Path to config file (~/.config/dex/dex.toml)
 */
export function getConfigPath(): string {
  const configDir = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(configDir, "dex", "dex.toml");
}

/**
 * Load configuration from file
 * @returns Configuration object or default if file doesn't exist
 */
export function loadConfig(): Config {
  const configPath = getConfigPath();

  // Return defaults if config file doesn't exist
  if (!fs.existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }

  try {
    const content = fs.readFileSync(configPath, "utf-8");
    const parsed = parseToml(content) as any;

    // Extract storage config, merging with defaults
    const storage: StorageConfig = {
      engine: parsed.storage?.engine || DEFAULT_CONFIG.storage.engine,
      file: parsed.storage?.file,
      "github-issues": parsed.storage?.["github-issues"],
      "github-projects": parsed.storage?.["github-projects"],
    };

    return { storage };
  } catch (err) {
    // If config file is malformed, log warning and use defaults
    console.warn(`Warning: Failed to parse config file at ${configPath}: ${err}`);
    return DEFAULT_CONFIG;
  }
}

