#!/usr/bin/env node

import { startMcpServer } from "./mcp/server.js";
import { runCli } from "./cli/commands.js";
import { loadConfig } from "./core/config.js";
import { StorageEngine } from "./core/storage-engine.js";
import { FileStorage } from "./core/storage.js";

const args = process.argv.slice(2);

// Parse global options
let storagePath: string | undefined;
const filteredArgs: string[] = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];

  if (arg === "--storage-path") {
    const nextArg = args[i + 1];
    if (!nextArg || nextArg.startsWith("-")) {
      console.error("Error: --storage-path requires a value");
      process.exit(1);
    }
    storagePath = nextArg;
    i++; // Skip the value in next iteration
  } else if (arg.startsWith("--storage-path=")) {
    const value = arg.slice("--storage-path=".length);
    if (!value) {
      console.error("Error: --storage-path requires a value");
      process.exit(1);
    }
    storagePath = value;
  } else {
    filteredArgs.push(arg);
  }
}

/**
 * Create storage engine based on configuration priority:
 * 1. Config file determines engine type
 * 2. For file storage specifically:
 *    a. CLI --storage-path flag
 *    b. Config file path setting
 *    c. DEX_STORAGE_PATH environment variable
 *    d. Auto-detect (git root or home)
 */
function createStorageEngine(cliStoragePath?: string): StorageEngine {
  // Load config to determine engine type
  const config = loadConfig();

  // If CLI --storage-path is provided, force file storage
  if (cliStoragePath) {
    return new FileStorage(cliStoragePath);
  }

  // Otherwise, use configured engine
  switch (config.storage.engine) {
    case "file": {
      // Priority for file storage path:
      // 1. Config file path
      // 2. DEX_STORAGE_PATH environment variable
      // 3. Auto-detect
      const filePath =
        config.storage.file?.path || process.env.DEX_STORAGE_PATH || undefined;
      return new FileStorage(filePath);
    }

    case "github-issues":
      throw new Error("GitHub Issues storage not yet implemented");

    case "github-projects":
      throw new Error("GitHub Projects storage not yet implemented");

    default:
      throw new Error(`Unknown storage engine: ${config.storage.engine}`);
  }
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
  --storage-path <path>      Override storage file location
  -h, --help                 Show this help message

${bold}DESCRIPTION:${reset}
  Starts the MCP server over stdio for integration with AI assistants.
  The server exposes task management tools that can be called by MCP clients.

${bold}EXAMPLE:${reset}
  dex mcp                    # Start MCP server with default storage
  dex mcp --storage-path ~/.dex/tasks
`);
    process.exit(0);
  }

  const storage = createStorageEngine(storagePath);
  startMcpServer(storage).catch((err) => {
    console.error("MCP server error:", err);
    process.exit(1);
  });
} else {
  const storage = createStorageEngine(storagePath);
  runCli(filteredArgs, { storage });
}
