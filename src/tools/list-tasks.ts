import { z } from "zod";
import { TaskService } from "../core/task-service.js";
import { jsonResponse, McpToolResponse } from "./response.js";

export const ListTasksArgsSchema = z.object({
  status: z.enum(["pending", "completed"]).optional().describe("Filter by status"),
  project: z.string().optional().describe("Filter by project"),
  query: z.string().optional().describe("Search in description and context"),
  all: z.boolean().optional().describe("Show all tasks (pending and completed)"),
});

export type ListTasksArgs = z.infer<typeof ListTasksArgsSchema>;

export function handleListTasks(args: ListTasksArgs, service: TaskService): McpToolResponse {
  const tasks = service.list(args);
  return jsonResponse(tasks);
}
