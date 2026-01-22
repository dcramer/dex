import { z } from "zod";
import { TaskService } from "../core/task-service.js";
import { jsonResponse, textResponse, McpToolResponse } from "./response.js";

export const UpdateTaskArgsSchema = z.object({
  id: z.string().describe("Task ID"),
  description: z.string().optional().describe("Updated description"),
  context: z.string().optional().describe("Updated context"),
  project: z.string().optional().describe("Updated project"),
  priority: z.number().optional().describe("Updated priority"),
  status: z.enum(["pending", "completed"]).optional().describe("Updated status"),
  result: z.string().optional().describe("Final output when completing task"),
  delete: z.boolean().optional().describe("Set to true to delete the task"),
});

export type UpdateTaskArgs = z.infer<typeof UpdateTaskArgsSchema>;

export function handleUpdateTask(args: UpdateTaskArgs, service: TaskService): McpToolResponse {
  if (args.delete) {
    const deleted = service.delete(args.id);
    const message = deleted ? `Task ${args.id} deleted` : `Task ${args.id} not found`;
    return textResponse(message);
  }

  const task = service.update(args);

  if (!task) {
    return textResponse(`Task ${args.id} not found`);
  }

  return jsonResponse(task);
}
