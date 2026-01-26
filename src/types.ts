import { z } from "zod";

// Maximum content length (50KB) to prevent excessive file sizes
const MAX_CONTENT_LENGTH = 50 * 1024;

export const CommitMetadataSchema = z.object({
  sha: z.string().min(1),
  message: z.string().optional(),
  branch: z.string().optional(),
  url: z.string().url().optional(),
  timestamp: z.string().datetime().optional(),
});

export type CommitMetadata = z.infer<typeof CommitMetadataSchema>;

export const GithubMetadataSchema = z.object({
  issueNumber: z.number().int().positive(),
  issueUrl: z.string().url(),
  repo: z.string().min(1), // owner/repo format
  state: z.enum(["open", "closed"]).optional(), // Last synced state for fast-path optimization
});

export type GithubMetadata = z.infer<typeof GithubMetadataSchema>;

export const TaskMetadataSchema = z
  .object({
    commit: CommitMetadataSchema.optional(),
    github: GithubMetadataSchema.optional(),
  })
  .nullable();

export type TaskMetadata = z.infer<typeof TaskMetadataSchema>;

// Schema that handles backwards compatibility with old `status` field
const TaskSchemaBase = z.object({
  id: z.string().min(1, "Task ID is required"),
  parent_id: z.string().min(1).nullable().default(null),
  description: z
    .string()
    .min(1, "Description is required")
    .max(MAX_CONTENT_LENGTH, "Description exceeds maximum length"),
  context: z
    .string()
    .max(MAX_CONTENT_LENGTH, "Context exceeds maximum length")
    .default(""),
  priority: z
    .number()
    .int()
    .min(0)
    .max(100, "Priority cannot exceed 100")
    .default(1),
  completed: z.boolean().default(false),
  result: z
    .string()
    .max(MAX_CONTENT_LENGTH, "Result exceeds maximum length")
    .nullable()
    .default(null),
  metadata: TaskMetadataSchema.default(null),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  completed_at: z.string().datetime().nullable().default(null),
  // Bidirectional blocking relationships
  blockedBy: z.array(z.string().min(1)).default([]), // Tasks that block this one
  blocks: z.array(z.string().min(1)).default([]), // Tasks this one blocks
  children: z.array(z.string().min(1)).default([]), // Child task IDs (inverse of parent_id)
});

// Preprocess to convert old `status` field to `completed` for backwards compatibility
// and add defaults for new fields
export const TaskSchema = z.preprocess((data) => {
  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;

    // Convert old status field
    if ("status" in obj && !("completed" in obj)) {
      const { status, ...rest } = obj;
      obj.completed = status === "completed";
      delete obj.status;
    }

    // Add defaults for new bidirectional relationship fields
    if (!("blockedBy" in obj)) obj.blockedBy = [];
    if (!("blocks" in obj)) obj.blocks = [];
    if (!("children" in obj)) obj.children = [];

    return obj;
  }
  return data;
}, TaskSchemaBase);

export type Task = z.infer<typeof TaskSchema>;

export const TaskStoreSchema = z.object({
  tasks: z.array(TaskSchema),
});

export type TaskStore = z.infer<typeof TaskStoreSchema>;

export const CreateTaskInputSchema = z.object({
  description: z
    .string()
    .min(1, "Description is required")
    .max(MAX_CONTENT_LENGTH, "Description exceeds maximum length"),
  context: z
    .string()
    .max(MAX_CONTENT_LENGTH, "Context exceeds maximum length")
    .optional(),
  parent_id: z.string().min(1).optional(),
  priority: z
    .number()
    .int()
    .min(0)
    .max(100, "Priority cannot exceed 100")
    .optional(),
  blocked_by: z.array(z.string().min(1)).optional(),
  // Optional fields for import/restore scenarios
  id: z.string().min(1).optional(), // Use specific ID (fails if conflict)
  completed: z.boolean().optional(),
  result: z
    .string()
    .max(MAX_CONTENT_LENGTH, "Result exceeds maximum length")
    .nullable()
    .optional(),
  metadata: TaskMetadataSchema.optional(),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional(),
  completed_at: z.string().datetime().nullable().optional(),
});

export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;

export const UpdateTaskInputSchema = z.object({
  id: z.string().min(1, "Task ID is required"),
  description: z
    .string()
    .min(1, "Description cannot be empty")
    .max(MAX_CONTENT_LENGTH, "Description exceeds maximum length")
    .optional(),
  context: z
    .string()
    .max(MAX_CONTENT_LENGTH, "Context exceeds maximum length")
    .optional(),
  parent_id: z.string().min(1).nullable().optional(),
  priority: z
    .number()
    .int()
    .min(0)
    .max(100, "Priority cannot exceed 100")
    .optional(),
  completed: z.boolean().optional(),
  result: z
    .string()
    .max(MAX_CONTENT_LENGTH, "Result exceeds maximum length")
    .optional(),
  metadata: TaskMetadataSchema.optional(),
  delete: z.boolean().optional(),
  add_blocked_by: z.array(z.string().min(1)).optional(),
  remove_blocked_by: z.array(z.string().min(1)).optional(),
});

export type UpdateTaskInput = z.infer<typeof UpdateTaskInputSchema>;

export const ListTasksInputSchema = z.object({
  completed: z.boolean().optional(),
  query: z.string().optional(),
  all: z.boolean().optional(),
  blocked: z.boolean().optional(),
  ready: z.boolean().optional(),
});

export type ListTasksInput = z.infer<typeof ListTasksInputSchema>;
