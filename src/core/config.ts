import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { parse as parseToml } from "smol-toml";

/**
 * Storage mode for file-based storage
 */
export type StorageMode = "in-repo" | "centralized";

/**
 * Auto-sync configuration for GitHub.
 */
export interface GitHubSyncAuto {
  /** Sync immediately on mutations (default: true) */
  on_change?: boolean;
  /** Max age before sync is considered stale (e.g., "1h", "30m", "1d") */
  max_age?: string;
}

/**
 * GitHub sync configuration.
 * Note: owner/repo are always inferred from git remote, not configured.
 */
export interface GitHubSyncConfig {
  /** Enable automatic GitHub sync on task create/update (default: false) */
  enabled?: boolean;
  /** Environment variable containing GitHub token (default: "GITHUB_TOKEN") */
  token_env?: string;
  /** Label prefix for dex tasks (default: "dex") */
  label_prefix?: string;
  /** Auto-sync settings */
  auto?: GitHubSyncAuto;
}

/**
 * Sync configuration
 */
export interface SyncConfig {
  /** GitHub sync settings */
  github?: GitHubSyncConfig;
}

/**
 * Storage engine configuration
 */
export interface StorageConfig {
  /** Storage engine type */
  engine: "file";

  /** File storage settings */
  file?: {
    /** Path to storage directory */
    path?: string;
    /** Storage mode: "in-repo" (default) or "centralized" */
    mode?: StorageMode;
  };
}

/**
 * Dex configuration
 */
export interface Config {
  /** Storage configuration */
  storage: StorageConfig;
  /** Sync configuration */
  sync?: SyncConfig;
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
 * Get the dex home directory.
 * Priority: DEX_HOME env var > XDG_CONFIG_HOME/dex > ~/.config/dex
 * @returns Path to dex home directory
 */
export function getDexHome(): string {
  if (process.env.DEX_HOME) {
    return process.env.DEX_HOME;
  }
  const configDir =
    process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(configDir, "dex");
}

/**
 * Get the global config file path
 * @returns Path to config file (~/.config/dex/dex.toml)
 */
export function getConfigPath(): string {
  return path.join(getDexHome(), "dex.toml");
}

/**
 * Get the per-project config file path in the current git repository.
 * Always looks in .dex/ at the git root, regardless of storage path configuration.
 * @returns Path to project config file (.dex/config.toml) or null if not in a git repo
 */
export function getProjectConfigPath(): string | null {
  let currentDir = process.cwd();

  // Walk up to find git root
  while (currentDir !== path.dirname(currentDir)) {
    const gitPath = path.join(currentDir, ".git");
    try {
      fs.statSync(gitPath);
      // Found git root, return .dex/config.toml path
      return path.join(currentDir, ".dex", "config.toml");
    } catch {
      // .git doesn't exist, continue up
    }
    currentDir = path.dirname(currentDir);
  }

  return null;
}

/**
 * Parse a TOML config file into a partial config object.
 */
function parseConfigFile(configPath: string): Partial<Config> | null {
  if (!fs.existsSync(configPath)) {
    return null;
  }

  const content = fs.readFileSync(configPath, "utf-8");
  try {
    const parsed = parseToml(content) as any;
    return {
      storage: parsed.storage,
      sync: parsed.sync,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse config file at ${configPath}: ${message}`);
  }
}

/**
 * Merge sync configuration, with b taking precedence over a.
 */
function mergeSyncConfig(
  a: SyncConfig | undefined,
  b: SyncConfig | undefined,
): SyncConfig | undefined {
  if (b === undefined) return a;

  const mergedAuto =
    b.github?.auto !== undefined
      ? { ...a?.github?.auto, ...b.github.auto }
      : a?.github?.auto;

  return {
    github: {
      ...a?.github,
      ...b.github,
      auto: mergedAuto,
    },
  };
}

/**
 * Deep merge two config objects, with b taking precedence over a.
 */
function mergeConfig(a: Config, b: Partial<Config> | null): Config {
  if (!b) return a;

  return {
    storage: {
      engine: b.storage?.engine ?? a.storage.engine,
      file: b.storage?.file ?? a.storage.file,
    },
    sync: mergeSyncConfig(a.sync, b.sync),
  };
}

/**
 * Options for loading configuration
 */
export interface LoadConfigOptions {
  /** Storage path for per-project config */
  storagePath?: string;
  /** Custom config file path (overrides global config) */
  configPath?: string;
}

/**
 * Load configuration with precedence: per-project > global/custom > defaults
 * @param options Optional configuration loading options
 * @returns Merged configuration object
 */
export function loadConfig(options?: LoadConfigOptions): Config {
  const { configPath } = options ?? {};

  // Start with defaults
  let config = { ...DEFAULT_CONFIG };

  // Layer global or custom config
  // If configPath is provided, use it instead of the global config
  const baseConfigPath = configPath ?? getConfigPath();
  const baseConfig = parseConfigFile(baseConfigPath);
  config = mergeConfig(config, baseConfig);

  // Layer per-project config from git root (if in a git repo)
  const projectConfigPath = getProjectConfigPath();
  if (projectConfigPath) {
    const projectConfig = parseConfigFile(projectConfigPath);
    config = mergeConfig(config, projectConfig);
  }

  return config;
}
