#!/usr/bin/env node

import { startMcpServer } from "./mcp/server.js";
import { runCli } from "./cli/commands.js";

const args = process.argv.slice(2);

// Parse global options
let storagePath: string | undefined;
const filteredArgs: string[] = [];

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--storage-path" && args[i + 1]) {
    storagePath = args[++i];
  } else {
    filteredArgs.push(args[i]);
  }
}

const command = filteredArgs[0];

if (command === "mcp") {
  startMcpServer(storagePath).catch((err) => {
    console.error("MCP server error:", err);
    process.exit(1);
  });
} else {
  runCli(filteredArgs, { storagePath });
}
