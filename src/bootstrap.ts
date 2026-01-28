import type { SyncConfig } from "./core/config.js";
import { loadConfig } from "./core/config.js";
import type { StorageEngine } from "./core/storage/index.js";
import { JsonlStorage } from "./core/storage/index.js";
import { SyncRegistry } from "./core/sync/index.js";
import { createGitHubSyncService } from "./core/github/index.js";
import { createShortcutSyncService } from "./core/shortcut/sync-factory.js";

export interface ParsedGlobalOptions {
  storagePath?: string;
  configPath?: string;
  filteredArgs: string[];
}

/**
 * Parse a global option flag. Handles both "--flag value" and "--flag=value" formats.
 */
function parseGlobalOption(
  args: string[],
  index: number,
  flagName: string,
): { value: string; skip: number } | null {
  const arg = args[index];
  const flagWithEquals = `--${flagName}=`;

  if (arg === `--${flagName}`) {
    const nextArg = args[index + 1];
    if (!nextArg || nextArg.startsWith("-")) {
      console.error(`Error: --${flagName} requires a value`);
      process.exit(1);
    }
    return { value: nextArg, skip: 1 };
  }

  if (arg.startsWith(flagWithEquals)) {
    const value = arg.slice(flagWithEquals.length);
    if (!value) {
      console.error(`Error: --${flagName} requires a value`);
      process.exit(1);
    }
    return { value, skip: 0 };
  }

  return null;
}

export function parseGlobalOptions(args: string[]): ParsedGlobalOptions {
  let storagePath: string | undefined;
  let configPath: string | undefined;
  const filteredArgs: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const storageResult = parseGlobalOption(args, i, "storage-path");
    if (storageResult) {
      storagePath = storageResult.value;
      i += storageResult.skip;
      continue;
    }

    const configResult = parseGlobalOption(args, i, "config");
    if (configResult) {
      configPath = configResult.value;
      i += configResult.skip;
      continue;
    }

    filteredArgs.push(args[i]);
  }

  return { storagePath, configPath, filteredArgs };
}

export function createStorageEngine(
  cliStoragePath?: string,
  cliConfigPath?: string,
): StorageEngine {
  const config = loadConfig({ configPath: cliConfigPath });

  if (cliStoragePath) {
    // Even with explicit storage path, load archive config
    return new JsonlStorage({
      path: cliStoragePath,
      archiveConfig: config.archive,
    });
  }

  if (config.storage.engine !== "file") {
    throw new Error(
      `Unsupported storage engine: ${config.storage.engine}.\n` +
        `Only "file" storage is supported. Use sync.github for GitHub integration.`,
    );
  }

  return new JsonlStorage({
    path: config.storage.file?.path,
    mode: config.storage.file?.mode,
    archiveConfig: config.archive,
  });
}

export interface SyncRegistryResult {
  syncRegistry: SyncRegistry | null;
  syncConfig: SyncConfig | null;
}

/**
 * Create a SyncRegistry from configuration.
 * Registers all enabled sync services based on config.
 */
export async function createSyncRegistry(
  storagePath: string,
  cliConfigPath?: string,
): Promise<SyncRegistryResult> {
  const config = loadConfig({ storagePath, configPath: cliConfigPath });
  const syncConfig = config.sync ?? null;

  const registry = new SyncRegistry();

  // Register GitHub sync service if configured
  const githubService = createGitHubSyncService(
    syncConfig?.github ?? undefined,
    storagePath,
  );
  if (githubService) {
    registry.register(githubService);
  }

  // Register Shortcut sync service if configured
  const shortcutService = await createShortcutSyncService(syncConfig?.shortcut);
  if (shortcutService) {
    registry.register(shortcutService);
  }

  return {
    syncRegistry: registry.hasServices() ? registry : null,
    syncConfig,
  };
}

export function getMcpHelpText(): string {
  const useColors = !process.env.NO_COLOR && process.stdout.isTTY;
  const bold = useColors ? "\x1b[1m" : "";
  const reset = useColors ? "\x1b[0m" : "";

  return `${bold}dex mcp${reset} - Start MCP (Model Context Protocol) server

${bold}USAGE:${reset}
  dex mcp [options]

${bold}OPTIONS:${reset}
  --config <path>            Use custom config file
  --storage-path <path>      Override storage file location
  -h, --help                 Show this help message

${bold}DESCRIPTION:${reset}
  Starts the MCP server over stdio for integration with AI assistants.
  The server exposes task management tools that can be called by MCP clients.

${bold}EXAMPLE:${reset}
  dex mcp                    # Start MCP server with default storage
  dex mcp --config ./test.toml
  dex mcp --storage-path ~/.dex/tasks
`;
}
