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

export function handleCreateTask(args: CreateTaskInput, service: TaskService): McpToolResponse {
  const task = service.create(args);
  return jsonResponse(task);
}
