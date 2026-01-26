import { z } from "zod";
import { TaskService } from "../core/task-service.js";
import { CreateTaskInput } from "../types.js";
import { jsonResponse, McpToolResponse } from "./response.js";

// Maximum content length (50KB) to prevent excessive file sizes
const MAX_CONTENT_LENGTH = 50 * 1024;

export const CreateTaskArgsSchema = z.object({
  description: z.string().min(1).max(MAX_CONTENT_LENGTH).describe("One-line summary (like GitHub Issue title). Action-oriented, specific. Example: 'Add JWT authentication to API endpoints'"),
  context: z.string().min(1).max(MAX_CONTENT_LENGTH).describe("Comprehensive context like a GitHub Issue body. Explain what needs to be done and why, the specific requirements and constraints, the implementation approach with steps and technical choices, how you'll know it's done, and any relevant files or dependencies. Write naturally - agents and humans should understand the full picture without asking questions."),
  parent_id: z.string().min(1).optional().describe("Parent task ID to create as child. Supports 3-level hierarchy: epic (L0) → task (L1) → subtask (L2). Cannot create children of subtasks (max depth enforced)."),
  priority: z.number().int().min(0).max(100).optional().describe("Priority level - lower number = higher priority (default: 1, max: 100)"),
  blocked_by: z.array(z.string().min(1)).optional().describe("Array of task IDs that must be completed before this task can be started. Creates bidirectional blocking relationships."),
});

export async function handleCreateTask(args: CreateTaskInput, service: TaskService): Promise<McpToolResponse> {
  const task = await service.create(args);
  return jsonResponse(task);
}
