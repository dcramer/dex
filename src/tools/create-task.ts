import { z } from "zod";
import { TaskService } from "../core/task-service.js";
import { jsonResponse, McpToolResponse } from "./response.js";

export const CreateTaskArgsSchema = z.object({
  description: z.string().describe("One-line summary of the task"),
  context: z.string().describe("Full implementation context and details"),
  project: z.string().optional().describe("Project grouping (default: 'default')"),
  priority: z.number().optional().describe("Priority level - lower number = higher priority (default: 1)"),
});

export type CreateTaskArgs = z.infer<typeof CreateTaskArgsSchema>;

export function handleCreateTask(args: CreateTaskArgs, service: TaskService): McpToolResponse {
  const task = service.create({
    description: args.description,
    context: args.context,
    project: args.project,
    priority: args.priority,
  });

  return jsonResponse(task);
}
