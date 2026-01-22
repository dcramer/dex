import { z } from "zod";
import { TaskService } from "../core/task-service.js";
import { TaskStatusSchema, UpdateTaskInput } from "../types.js";
import { jsonResponse, McpToolResponse } from "./response.js";

export const UpdateTaskArgsSchema = z.object({
  id: z.string().min(1).describe("Task ID"),
  description: z.string().min(1).optional().describe("Updated description"),
  context: z.string().min(1).optional().describe("Updated context"),
  parent_id: z.string().min(1).nullable().optional().describe("Parent task ID (null to remove parent)"),
  priority: z.number().int().min(0).optional().describe("Updated priority"),
  status: TaskStatusSchema.optional().describe("Updated status"),
  result: z.string().optional().describe("Final output when completing task"),
  delete: z.boolean().optional().describe("Set to true to delete the task"),
});

export function handleUpdateTask(args: UpdateTaskInput, service: TaskService): McpToolResponse {
  if (args.delete) {
    const deletedTask = service.update(args);
    return jsonResponse({ deleted: true, id: args.id, task: deletedTask });
  }
  return jsonResponse(service.update(args));
}
