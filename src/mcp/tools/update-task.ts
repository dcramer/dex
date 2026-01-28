import { z } from "zod";
import { TaskService } from "../../core/task-service.js";
import type { UpdateTaskInput } from "../../types.js";
import type { McpToolResponse } from "./response.js";
import { jsonResponse } from "./response.js";

// Maximum content length (50KB) to prevent excessive file sizes
const MAX_CONTENT_LENGTH = 50 * 1024;

// Git SHA validation: 40 hex chars (full SHA) or 7+ hex chars (short SHA prefix)
const gitShaRegex = /^[0-9a-f]{7,40}$/i;

export const UpdateTaskArgsSchema = z.object({
  id: z.string().min(1).describe("Task ID"),
  name: z
    .string()
    .min(1)
    .max(MAX_CONTENT_LENGTH)
    .optional()
    .describe("Updated name"),
  description: z
    .string()
    .min(1)
    .max(MAX_CONTENT_LENGTH)
    .optional()
    .describe("Updated description"),
  parent_id: z
    .string()
    .min(1)
    .nullable()
    .optional()
    .describe("Parent task ID (null to remove parent)"),
  priority: z
    .number()
    .int()
    .min(0)
    .max(100)
    .optional()
    .describe("Updated priority"),
  completed: z
    .boolean()
    .optional()
    .describe("Mark task as completed (true) or pending (false)"),
  started_at: z
    .string()
    .datetime()
    .nullable()
    .optional()
    .describe(
      "Timestamp when task was started (ISO 8601). Set to mark as in-progress, null to clear.",
    ),
  result: z
    .string()
    .max(MAX_CONTENT_LENGTH)
    .optional()
    .describe(
      "Implementation summary like a PR description. Explain what was implemented and how the solution works, key decisions made and their rationale, trade-offs or alternatives you considered, and any follow-up work or tech debt. Write naturally so anyone can understand the solution without reading code.",
    ),
  commit_sha: z
    .string()
    .regex(gitShaRegex, "Invalid git SHA format (expected 7-40 hex characters)")
    .optional()
    .describe("Git commit SHA that implements this task"),
  commit_message: z.string().optional().describe("Commit message"),
  commit_branch: z
    .string()
    .optional()
    .describe("Branch name where commit was made"),
  commit_url: z
    .string()
    .url()
    .optional()
    .describe("URL to the commit (e.g., GitHub commit URL)"),
  delete: z.boolean().optional().describe("Set to true to delete the task"),
  add_blocked_by: z
    .array(z.string().min(1))
    .optional()
    .describe(
      "Array of task IDs to add as blockers. These tasks must be completed before this one can start.",
    ),
  remove_blocked_by: z
    .array(z.string().min(1))
    .optional()
    .describe("Array of task IDs to remove as blockers."),
});

type UpdateTaskArgs = z.infer<typeof UpdateTaskArgsSchema>;

export async function handleUpdateTask(
  args: UpdateTaskArgs,
  service: TaskService,
): Promise<McpToolResponse> {
  // Convert flat commit params to nested metadata structure
  const {
    commit_sha,
    commit_message,
    commit_branch,
    commit_url,
    add_blocked_by,
    remove_blocked_by,
    ...rest
  } = args;

  const updateInput: UpdateTaskInput = {
    ...rest,
    add_blocked_by,
    remove_blocked_by,
  };

  if (commit_sha) {
    updateInput.metadata = {
      commit: {
        sha: commit_sha,
        message: commit_message,
        branch: commit_branch,
        url: commit_url,
        timestamp: new Date().toISOString(),
      },
    };
  }

  if (updateInput.delete) {
    const deletedTask = await service.update(updateInput);
    return jsonResponse({
      deleted: true,
      id: updateInput.id,
      task: deletedTask,
    });
  }
  return jsonResponse(await service.update(updateInput));
}
