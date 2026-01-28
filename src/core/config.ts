import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseToml } from "smol-toml";
import { findGitRoot, getDexHome, type StorageMode } from "./storage/paths.js";

// Re-export path utilities for backward compatibility
export { getDexHome, type StorageMode } from "./storage/paths.js";

/**
 * Base auto-sync configuration for all integrations.
 */
export interface IntegrationSyncAuto {
  /** Sync immediately on mutations (default: true) */
  on_change?: boolean;
  /** Max age before sync is considered stale (e.g., "1h", "30m", "1d") */
  max_age?: string;
}

/**
 * Base sync configuration for all integrations.
 */
export interface IntegrationSyncConfig {
  /** Enable automatic sync on task create/update (default: false) */
  enabled?: boolean;
  /** Auto-sync settings */
  auto?: IntegrationSyncAuto;
}

/**
 * GitHub sync configuration.
 * Note: owner/repo are always inferred from git remote, not configured.
 */
export interface GitHubSyncConfig extends IntegrationSyncConfig {
  /** Environment variable containing GitHub token (default: "GITHUB_TOKEN") */
  token_env?: string;
  /** Label prefix for dex tasks (default: "dex") */
  label_prefix?: string;
}

/**
 * Shortcut sync configuration.
 */
export interface ShortcutSyncConfig extends IntegrationSyncConfig {
  /** Environment variable containing Shortcut API token (default: "SHORTCUT_API_TOKEN") */
  token_env?: string;
  /** Shortcut workspace slug (inferred from API if not set) */
  workspace?: string;
  /** Team ID or mention name for story creation (required for auto-sync) */
  team?: string;
  /** Workflow ID to use (uses team default if not set) */
  workflow?: number;
  /** Label name for dex stories (default: "dex") */
  label?: string;
}

/**
 * Sync configuration
 */
export interface SyncConfig {
  /** GitHub sync settings */
  github?: GitHubSyncConfig;
  /** Shortcut sync settings */
  shortcut?: ShortcutSyncConfig;
}

/**
 * Archive configuration
 */
export interface ArchiveConfig {
  /** Enable automatic archiving (default: false) */
  auto?: boolean;
  /** Minimum age in days before auto-archiving (default: 90) */
  age_days?: number;
  /** Number of recent completed tasks to keep (default: 50) */
  keep_recent?: number;
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
  /** Archive configuration */
  archive?: ArchiveConfig;
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
  const gitRoot = findGitRoot(process.cwd());
  if (!gitRoot) {
    return null;
  }
  return path.join(gitRoot, ".dex", "config.toml");
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
      archive: parsed.archive,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to parse config file at ${configPath}: ${message}`);
  }
}

/**
 * Merge a single integration config, with b taking precedence over a.
 */
function mergeIntegrationConfig<T extends IntegrationSyncConfig>(
  a: T | undefined,
  b: T | undefined,
): T | undefined {
  if (!a) return b;
  if (!b) return a;

  const mergedAuto = b.auto ? { ...a.auto, ...b.auto } : a.auto;
  return { ...a, ...b, auto: mergedAuto } as T;
}

/**
 * Merge sync configuration, with b taking precedence over a.
 */
function mergeSyncConfig(
  a: SyncConfig | undefined,
  b: SyncConfig | undefined,
): SyncConfig | undefined {
  if (!a) return b;
  if (!b) return a;
  return {
    github: mergeIntegrationConfig(a.github, b.github),
    shortcut: mergeIntegrationConfig(a.shortcut, b.shortcut),
  };
}

/**
 * Merge archive configuration, with b taking precedence over a.
 */
function mergeArchiveConfig(
  a: ArchiveConfig | undefined,
  b: ArchiveConfig | undefined,
): ArchiveConfig | undefined {
  if (!a) return b;
  if (!b) return a;
  return { ...a, ...b };
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
    archive: mergeArchiveConfig(a.archive, b.archive),
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
