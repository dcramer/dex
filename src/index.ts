#!/usr/bin/env node

import { startMcpServer } from "./mcp/server.js";
import { runCli } from "./cli/index.js";
import { loadConfig } from "./core/config.js";
import { StorageEngine } from "./core/storage-engine.js";
import { FileStorage } from "./core/storage.js";
import { GitHubIssuesStorage } from "./core/github-issues-storage.js";
import { createGitHubSyncService, GitHubSyncService } from "./core/github-sync.js";

const args = process.argv.slice(2);

interface ParsedGlobalOptions {
  storagePath?: string;
  configPath?: string;
  filteredArgs: string[];
}

/**
 * Parse a global option flag (e.g., --config, --storage-path).
 * Handles both "--flag value" and "--flag=value" formats.
 * Returns the value and the number of args consumed, or null if not matched.
 */
function parseGlobalOption(
  args: string[],
  index: number,
  flagName: string
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

function parseGlobalOptions(args: string[]): ParsedGlobalOptions {
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

const { storagePath, configPath, filteredArgs } = parseGlobalOptions(args);

/**
 * Create storage engine based on configuration priority:
 * 1. Config file determines engine type
 * 2. For file storage specifically:
 *    a. CLI --storage-path flag
 *    b. Config file path setting
 *    c. DEX_STORAGE_PATH environment variable
 *    d. Auto-detect (git root or home)
 */
function createStorageEngine(cliStoragePath?: string, cliConfigPath?: string): StorageEngine {
  // Load config to determine engine type
  const config = loadConfig({ configPath: cliConfigPath });

  // If CLI --storage-path is provided, force file storage
  if (cliStoragePath) {
    return new FileStorage(cliStoragePath);
  }

  // Otherwise, use configured engine
  switch (config.storage.engine) {
    case "file": {
      // FileStorage handles path resolution: config path -> DEX_STORAGE_PATH -> auto-detect
      return new FileStorage({
        path: config.storage.file?.path,
        mode: config.storage.file?.mode,
      });
    }

    case "github-issues": {
      console.warn(
        "Warning: storage.engine = 'github-issues' is deprecated.\n" +
        "GitHub Issues is now an auto-sync enhancement. Use file storage with sync.github instead:\n\n" +
        "  [storage]\n" +
        "  engine = \"file\"\n\n" +
        "  [sync.github]\n" +
        "  enabled = true\n" +
        "  owner = \"your-owner\"\n" +
        "  repo = \"your-repo\"\n"
      );

      const ghConfig = config.storage["github-issues"];
      if (!ghConfig) {
        throw new Error("GitHub Issues storage selected but not configured");
      }

      // Get token from environment variable
      const tokenEnv = ghConfig.token_env || "GITHUB_TOKEN";
      const token = process.env[tokenEnv];
      if (!token) {
        throw new Error(
          `GitHub token not found in environment variable ${tokenEnv}`
        );
      }

      return new GitHubIssuesStorage({
        owner: ghConfig.owner,
        repo: ghConfig.repo,
        token,
        labelPrefix: ghConfig.label_prefix,
      });
    }

    case "github-projects":
      throw new Error("GitHub Projects storage not yet implemented");

    default:
      throw new Error(`Unknown storage engine: ${config.storage.engine}`);
  }
}

interface SyncServiceResult {
  syncService: GitHubSyncService | null;
  syncConfig: import("./core/config.js").GitHubSyncConfig | null;
}

/**
 * Create GitHub sync service if configured.
 * Returns both the service and the config for auto-sync settings.
 */
function createSyncService(storagePath: string, cliConfigPath?: string): SyncServiceResult {
  const config = loadConfig({ storagePath, configPath: cliConfigPath });
  const githubConfig = config.sync?.github ?? null;
  return {
    syncService: createGitHubSyncService(githubConfig ?? undefined),
    syncConfig: githubConfig,
  };
}

const command = filteredArgs[0];

if (command === "mcp") {
  // Check for --help flag
  if (filteredArgs.includes("--help") || filteredArgs.includes("-h")) {
    // Color support: disable if NO_COLOR is set or stdout is not a TTY
    const useColors = !process.env.NO_COLOR && process.stdout.isTTY;
    const bold = useColors ? "\x1b[1m" : "";
    const reset = useColors ? "\x1b[0m" : "";

    console.log(`${bold}dex mcp${reset} - Start MCP (Model Context Protocol) server

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
`);
    process.exit(0);
  }

  const storage = createStorageEngine(storagePath, configPath);
  const { syncService, syncConfig } = createSyncService(storage.getIdentifier(), configPath);
  startMcpServer(storage, syncService, syncConfig).catch((err) => {
    console.error("MCP server error:", err);
    process.exit(1);
  });
} else {
  const storage = createStorageEngine(storagePath, configPath);
  const { syncService, syncConfig } = createSyncService(storage.getIdentifier(), configPath);
  runCli(filteredArgs, { storage, syncService, syncConfig }).catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
}
