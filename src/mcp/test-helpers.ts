/**
 * Shared test utilities for MCP server tests.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FileStorage } from "../core/storage/index.js";
import { createMcpServer } from "./server.js";

export interface McpTestContext {
  client: Client;
  storage: FileStorage;
  cleanup: () => Promise<void>;
}

/**
 * Creates a test context with an in-process MCP client/server pair.
 * Uses InMemoryTransport for isolated testing without stdio.
 */
export async function createMcpTestContext(): Promise<McpTestContext> {
  // Create temp storage
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dex-mcp-test-"));
  const storage = new FileStorage(tempDir);

  // Create linked transport pair
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  // Create and connect server
  const server = createMcpServer(storage);
  await server.connect(serverTransport);

  // Create and connect client
  const client = new Client({
    name: "test-client",
    version: "1.0.0",
  });
  await client.connect(clientTransport);

  return {
    client,
    storage,
    cleanup: async () => {
      await client.close();
      await server.close();
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

/** The result type from client.callTool() */
type CallToolResult = Awaited<ReturnType<Client["callTool"]>>;

/**
 * Parses the JSON content from an MCP tool response.
 * MCP returns content as an array of content blocks; this extracts and parses the first text block.
 */
export function parseToolResponse<T>(result: CallToolResult): T {
  const content = (result as { content?: unknown[] }).content;
  if (!Array.isArray(content)) {
    throw new Error("Unexpected response format: missing content array");
  }

  const textBlock = content.find((c) => (c as { type: string }).type === "text");
  if (!textBlock) {
    throw new Error("No text content in response");
  }
  return JSON.parse((textBlock as { text: string }).text) as T;
}

/**
 * Checks if a callTool result indicates an error.
 */
export function isErrorResult(result: CallToolResult): boolean {
  return "isError" in result && result.isError === true;
}
