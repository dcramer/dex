import { z } from "zod";

export const TaskStatusSchema = z.enum(["pending", "completed"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskSchema = z.object({
  id: z.string().min(1, "Task ID is required"),
  parent_id: z.string().min(1).nullable().default(null),
  description: z.string().min(1, "Description is required"),
  context: z.string().min(1, "Context is required"),
  priority: z.number().int().min(0).default(1),
  status: TaskStatusSchema.default("pending"),
  result: z.string().nullable().default(null),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  completed_at: z.string().datetime().nullable().default(null),
});

export type Task = z.infer<typeof TaskSchema>;

export const TaskStoreSchema = z.object({
  tasks: z.array(TaskSchema),
});

export type TaskStore = z.infer<typeof TaskStoreSchema>;

export const CreateTaskInputSchema = z.object({
  description: z.string().min(1, "Description is required"),
  context: z.string().min(1, "Context is required"),
  parent_id: z.string().min(1).optional(),
  priority: z.number().int().min(0).optional(),
});

export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;

export const UpdateTaskInputSchema = z.object({
  id: z.string().min(1, "Task ID is required"),
  description: z.string().min(1, "Description cannot be empty").optional(),
  context: z.string().min(1, "Context cannot be empty").optional(),
  parent_id: z.string().min(1).nullable().optional(),
  priority: z.number().int().min(0).optional(),
  status: TaskStatusSchema.optional(),
  result: z.string().optional(),
  delete: z.boolean().optional(),
});

export type UpdateTaskInput = z.infer<typeof UpdateTaskInputSchema>;

export const ListTasksInputSchema = z.object({
  status: TaskStatusSchema.optional(),
  query: z.string().optional(),
  all: z.boolean().optional(),
});

export type ListTasksInput = z.infer<typeof ListTasksInputSchema>;
