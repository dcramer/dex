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

export const ShortcutMetadataSchema = z.object({
  storyId: z.number().int().positive(),
  storyUrl: z.string().url(),
  workspace: z.string().min(1),
  state: z.enum(["unstarted", "started", "done"]).optional(), // Last synced workflow state
});

export type ShortcutMetadata = z.infer<typeof ShortcutMetadataSchema>;

export const TaskMetadataSchema = z
  .object({
    commit: CommitMetadataSchema.optional(),
    github: GithubMetadataSchema.optional(),
    shortcut: ShortcutMetadataSchema.optional(),
  })
  .nullable();

export type TaskMetadata = z.infer<typeof TaskMetadataSchema>;

// Schema that handles backwards compatibility with old `status` field
const TaskSchemaBase = z.object({
  id: z.string().min(1, "Task ID is required"),
  parent_id: z.string().min(1).nullable().default(null),
  name: z
    .string()
    .min(1, "Name is required")
    .max(MAX_CONTENT_LENGTH, "Name exceeds maximum length"),
  description: z
    .string()
    .max(MAX_CONTENT_LENGTH, "Description exceeds maximum length")
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
  started_at: z.string().datetime().nullable().default(null),
  completed_at: z.string().datetime().nullable().default(null),
  // Bidirectional blocking relationships
  blockedBy: z.array(z.string().min(1)).default([]), // Tasks that block this one
  blocks: z.array(z.string().min(1)).default([]), // Tasks this one blocks
  children: z.array(z.string().min(1)).default([]), // Child task IDs (inverse of parent_id)
});

// Preprocess to convert old fields for backwards compatibility
export const TaskSchema = z.preprocess((data) => {
  if (typeof data === "object" && data !== null) {
    const obj = data as Record<string, unknown>;

    // Convert old status field
    if ("status" in obj && !("completed" in obj)) {
      obj.completed = obj.status === "completed";
      delete obj.status;
    }

    // Migrate old field names: description → name, context → description
    // Old format: { description: "short title", context: "long details" }
    // New format: { name: "short title", description: "long details" }
    // Detect old format by presence of 'context' field or absence of 'name' field
    if ("context" in obj || !("name" in obj)) {
      const oldDescription = obj.description; // This was the short title
      const oldContext = obj.context ?? ""; // This was the long details
      obj.name = oldDescription;
      obj.description = oldContext;
      delete obj.context;
    }

    // Add defaults for new bidirectional relationship fields
    if (!("blockedBy" in obj)) obj.blockedBy = [];
    if (!("blocks" in obj)) obj.blocks = [];
    if (!("children" in obj)) obj.children = [];

    // Add default for started_at field (backward compatibility)
    if (!("started_at" in obj)) obj.started_at = null;

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
  name: z
    .string()
    .min(1, "Name is required")
    .max(MAX_CONTENT_LENGTH, "Name exceeds maximum length"),
  description: z
    .string()
    .max(MAX_CONTENT_LENGTH, "Description exceeds maximum length")
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
  started_at: z.string().datetime().nullable().optional(),
  completed_at: z.string().datetime().nullable().optional(),
});

export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;

export const UpdateTaskInputSchema = z.object({
  id: z.string().min(1, "Task ID is required"),
  name: z
    .string()
    .min(1, "Name cannot be empty")
    .max(MAX_CONTENT_LENGTH, "Name exceeds maximum length")
    .optional(),
  description: z
    .string()
    .max(MAX_CONTENT_LENGTH, "Description exceeds maximum length")
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
  started_at: z.string().datetime().nullable().optional(),
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
  in_progress: z.boolean().optional(), // If true, list only in-progress tasks
  archived: z.boolean().optional(), // If true, list only archived tasks
});

export type ListTasksInput = z.infer<typeof ListTasksInputSchema>;

// Archived task schema - compacted version of Task for long-term storage
// Drops: blockedBy, blocks, children, created_at, updated_at, priority
// Keeps: id, parent_id, name, description, completed_at, archived_at, result, metadata.github
// Adds: archived_children for rolled-up subtasks
export const ArchivedChildSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().default(""),
  result: z.string().nullable().default(null),
});

export type ArchivedChild = z.infer<typeof ArchivedChildSchema>;

export const ArchivedTaskSchema = z.object({
  id: z.string().min(1, "Task ID is required"),
  parent_id: z.string().min(1).nullable().default(null),
  name: z.string().min(1, "Name is required"),
  description: z.string().default(""),
  result: z.string().nullable().default(null),
  completed_at: z.string().datetime().nullable().default(null),
  archived_at: z.string().datetime(),
  metadata: z
    .object({
      github: GithubMetadataSchema.optional(),
      shortcut: ShortcutMetadataSchema.optional(),
      commit: CommitMetadataSchema.optional(),
    })
    .nullable()
    .default(null),
  archived_children: z.array(ArchivedChildSchema).default([]),
});

export type ArchivedTask = z.infer<typeof ArchivedTaskSchema>;

export const ArchiveStoreSchema = z.object({
  tasks: z.array(ArchivedTaskSchema),
});

export type ArchiveStore = z.infer<typeof ArchiveStoreSchema>;
