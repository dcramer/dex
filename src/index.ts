#!/usr/bin/env node

import { startMcpServer } from "./mcp/server.js";
import { runCli } from "./cli/index.js";
import {
  parseGlobalOptions,
  createStorageEngine,
  createSyncService,
  getMcpHelpText,
} from "./bootstrap.js";

const args = process.argv.slice(2);
const { storagePath, configPath, filteredArgs } = parseGlobalOptions(args);
const command = filteredArgs[0];

if (command === "mcp" && (filteredArgs.includes("--help") || filteredArgs.includes("-h"))) {
  console.log(getMcpHelpText());
  process.exit(0);
}

const storage = createStorageEngine(storagePath, configPath);
const { syncService, syncConfig } = createSyncService(
  storage.getIdentifier(),
  configPath
);

if (command === "mcp") {
  startMcpServer(storage, syncService, syncConfig).catch((err) => {
    console.error("MCP server error:", err);
    process.exit(1);
  });
} else {
  runCli(filteredArgs, { storage, syncService, syncConfig }).catch((err) => {
    console.error("Error:", err);
    process.exit(1);
  });
}
