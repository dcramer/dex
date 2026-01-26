import { loadConfig, GitHubSyncConfig } from "./core/config.js";
import {
  StorageEngine,
  FileStorage,
  GitHubIssuesStorage,
} from "./core/storage/index.js";
import {
  createGitHubSyncService,
  GitHubSyncService,
} from "./core/github/index.js";

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
  cliConfigPath?: string
): StorageEngine {
  const config = loadConfig({ configPath: cliConfigPath });

  if (cliStoragePath) {
    return new FileStorage(cliStoragePath);
  }

  switch (config.storage.engine) {
    case "file":
      return new FileStorage({
        path: config.storage.file?.path,
        mode: config.storage.file?.mode,
      });

    case "github-issues":
      return createGitHubIssuesStorage(config);

    case "github-projects":
      throw new Error("GitHub Projects storage not yet implemented");

    default:
      throw new Error(`Unknown storage engine: ${config.storage.engine}`);
  }
}

function createGitHubIssuesStorage(
  config: ReturnType<typeof loadConfig>
): GitHubIssuesStorage {
  console.warn(
    "Warning: storage.engine = 'github-issues' is deprecated.\n" +
      "GitHub Issues is now an auto-sync enhancement. Use file storage with sync.github instead:\n\n" +
      "  [storage]\n" +
      '  engine = "file"\n\n' +
      "  [sync.github]\n" +
      "  enabled = true\n" +
      '  owner = "your-owner"\n' +
      '  repo = "your-repo"\n'
  );

  const ghConfig = config.storage["github-issues"];
  if (!ghConfig) {
    throw new Error("GitHub Issues storage selected but not configured");
  }

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

export interface SyncServiceResult {
  syncService: GitHubSyncService | null;
  syncConfig: GitHubSyncConfig | null;
}

export function createSyncService(
  storagePath: string,
  cliConfigPath?: string
): SyncServiceResult {
  const config = loadConfig({ storagePath, configPath: cliConfigPath });
  const githubConfig = config.sync?.github ?? null;
  return {
    syncService: createGitHubSyncService(githubConfig ?? undefined),
    syncConfig: githubConfig,
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
