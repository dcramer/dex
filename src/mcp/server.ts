import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ZodError, ZodType } from "zod";
import { TaskService } from "../core/task-service.js";
import type { StorageEngine } from "../core/storage/index.js";
import type { SyncRegistry } from "../core/sync/index.js";
import type { SyncConfig } from "../core/config.js";
import { CreateTaskArgsSchema, handleCreateTask } from "./tools/create-task.js";
import { UpdateTaskArgsSchema, handleUpdateTask } from "./tools/update-task.js";
import { ListTasksArgsSchema, handleListTasks } from "./tools/list-tasks.js";
import type { McpToolResponse } from "./tools/response.js";
import { errorResponse } from "./tools/response.js";
import { ValidationError } from "../errors.js";

function formatZodError(error: ZodError): string {
  return error.errors
    .map((e) => `${e.path.join(".")}: ${e.message}`)
    .join(", ");
}

function wrapHandler<T>(
  schema: ZodType<T>,
  handler: (args: T, service: TaskService) => Promise<McpToolResponse>,
  service: TaskService,
): (args: unknown) => Promise<McpToolResponse> {
  return async (args) => {
    try {
      const parsed = schema.parse(args);
      return await handler(parsed, service);
    } catch (err) {
      if (err instanceof ZodError) {
        return errorResponse(
          new ValidationError(`Validation error: ${formatZodError(err)}`),
        );
      }
      return errorResponse(err);
    }
  };
}

/**
 * Creates an MCP server instance with all tools registered.
 * Exported for testing purposes.
 */
export function createMcpServer(
  storage: StorageEngine,
  syncRegistry?: SyncRegistry | null,
  syncConfig?: SyncConfig | null,
): McpServer {
  const service = new TaskService({ storage, syncRegistry, syncConfig });
  const server = new McpServer({
    name: "dex",
    version: "1.0.0",
  });

  server.tool(
    "create_task",
    "Create a task ticket with comprehensive context like a GitHub Issue. Explain what needs to be done and why, the requirements and constraints, your implementation approach, and how you'll know it's complete. Use this for complex work that needs coordination across sessions or when context should persist. Break large work into subtasks for better tracking.",
    CreateTaskArgsSchema.shape,
    wrapHandler(CreateTaskArgsSchema, handleCreateTask, service),
  );

  server.tool(
    "update_task",
    "Update task fields, mark complete with result, or delete. When completing, provide comprehensive result: what was implemented, key decisions made, trade-offs considered, any follow-ups needed. Think PR description: explain the resolution at a high level without reading code.",
    UpdateTaskArgsSchema.shape,
    wrapHandler(UpdateTaskArgsSchema, handleUpdateTask, service),
  );

  server.tool(
    "list_tasks",
    "List and search tasks. Use to review context, find related work, or understand current state. Filter by status, search content. By default shows only pending tasks.",
    ListTasksArgsSchema.shape,
    wrapHandler(ListTasksArgsSchema, handleListTasks, service),
  );

  return server;
}

/**
 * Starts the MCP server with the given storage and transport.
 * If no transport is provided, uses StdioServerTransport.
 */
export async function startMcpServer(
  storage: StorageEngine,
  syncRegistry?: SyncRegistry | null,
  syncConfig?: SyncConfig | null,
  transport?: Transport,
): Promise<void> {
  const server = createMcpServer(storage, syncRegistry, syncConfig);
  await server.connect(transport ?? new StdioServerTransport());
}
