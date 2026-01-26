import { z } from "zod";
import { TaskService } from "../../core/task-service.js";
import { ListTasksInput } from "../../types.js";
import { jsonResponse, McpToolResponse } from "./response.js";

export const ListTasksArgsSchema = z.object({
  completed: z
    .boolean()
    .optional()
    .describe(
      "Filter by completion status (true = completed, false = pending)",
    ),
  query: z.string().optional().describe("Search in name and description"),
  all: z
    .boolean()
    .optional()
    .describe("Show all tasks (pending and completed)"),
  blocked: z
    .boolean()
    .optional()
    .describe("Filter to only blocked tasks (tasks with incomplete blockers)"),
  ready: z
    .boolean()
    .optional()
    .describe(
      "Filter to only ready tasks (pending tasks with all blockers completed)",
    ),
});

export async function handleListTasks(
  args: ListTasksInput,
  service: TaskService,
): Promise<McpToolResponse> {
  return jsonResponse(await service.list(args));
}
