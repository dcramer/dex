import { z } from "zod";
import { TaskService } from "../core/task-service.js";
import { TaskStatusSchema, ListTasksInput } from "../types.js";
import { jsonResponse, McpToolResponse } from "./response.js";

export const ListTasksArgsSchema = z.object({
  status: TaskStatusSchema.optional().describe("Filter by status"),
  query: z.string().optional().describe("Search in description and context"),
  all: z.boolean().optional().describe("Show all tasks (pending and completed)"),
});

export type ListTasksArgs = ListTasksInput;

/**
 * Handle the list_tasks MCP tool call.
 * Errors are propagated to the MCP server layer for consistent handling.
 */
export function handleListTasks(args: ListTasksArgs, service: TaskService): McpToolResponse {
  const tasks = service.list(args);
  return jsonResponse(tasks);
}
