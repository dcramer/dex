import { z } from "zod";

export const TaskStatusSchema = z.enum(["pending", "completed"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

export const TaskSchema = z.object({
  id: z.string(),
  project: z.string().default("default"),
  description: z.string(),
  context: z.string(),
  priority: z.number().int().default(1),
  status: TaskStatusSchema.default("pending"),
  result: z.string().nullable().default(null),
  created_at: z.string(),
  updated_at: z.string(),
});

export type Task = z.infer<typeof TaskSchema>;

export const TaskStoreSchema = z.object({
  tasks: z.array(TaskSchema),
});

export type TaskStore = z.infer<typeof TaskStoreSchema>;

export const CreateTaskInputSchema = z.object({
  description: z.string().min(1, "Description is required"),
  context: z.string().min(1, "Context is required"),
  project: z.string().optional(),
  priority: z.number().int().optional(),
});

export type CreateTaskInput = z.infer<typeof CreateTaskInputSchema>;

export const UpdateTaskInputSchema = z.object({
  id: z.string(),
  description: z.string().optional(),
  context: z.string().optional(),
  project: z.string().optional(),
  priority: z.number().int().optional(),
  status: TaskStatusSchema.optional(),
  result: z.string().optional(),
  delete: z.boolean().optional(),
});

export type UpdateTaskInput = z.infer<typeof UpdateTaskInputSchema>;

export const ListTasksInputSchema = z.object({
  status: TaskStatusSchema.optional(),
  project: z.string().optional(),
  query: z.string().optional(),
  all: z.boolean().optional(),
});

export type ListTasksInput = z.infer<typeof ListTasksInputSchema>;
