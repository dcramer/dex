import { z } from "zod";
import { TaskService } from "../core/task-service.js";
import { CreateTaskInput } from "../types.js";
import { jsonResponse, McpToolResponse } from "./response.js";

export const CreateTaskArgsSchema = z.object({
  description: z.string().min(1).describe("One-line summary of the task"),
  context: z.string().min(1).describe("Full implementation context and details"),
  parent_id: z.string().min(1).optional().describe("Parent task ID to create as subtask"),
  priority: z.number().int().min(0).optional().describe("Priority level - lower number = higher priority (default: 1)"),
});

export type CreateTaskArgs = CreateTaskInput;

/**
 * Handle the create_task MCP tool call.
 * Errors are propagated to the MCP server layer for consistent handling.
 */
export function handleCreateTask(args: CreateTaskArgs, service: TaskService): McpToolResponse {
  const task = service.create({
    description: args.description,
    context: args.context,
    parent_id: args.parent_id,
    priority: args.priority,
  });

  return jsonResponse(task);
}
