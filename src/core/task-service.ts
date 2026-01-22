import { customAlphabet } from "nanoid";
import { TaskStorage } from "./storage.js";
import {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  ListTasksInput,
} from "../types.js";

const generateId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

export class TaskService {
  private storage: TaskStorage;

  constructor(storagePath?: string) {
    this.storage = new TaskStorage(storagePath);
  }

  create(input: CreateTaskInput): Task {
    const store = this.storage.read();
    const now = new Date().toISOString();

    const task: Task = {
      id: generateId(),
      project: input.project || "default",
      description: input.description,
      context: input.context,
      priority: input.priority ?? 1,
      status: "pending",
      result: null,
      created_at: now,
      updated_at: now,
    };

    store.tasks.push(task);
    this.storage.write(store);

    return task;
  }

  update(input: UpdateTaskInput): Task | null {
    const store = this.storage.read();
    const index = store.tasks.findIndex((t) => t.id === input.id);

    if (index === -1) {
      return null;
    }

    if (input.delete) {
      store.tasks.splice(index, 1);
      this.storage.write(store);
      return null;
    }

    const task = store.tasks[index];
    const now = new Date().toISOString();

    if (input.description !== undefined) task.description = input.description;
    if (input.context !== undefined) task.context = input.context;
    if (input.project !== undefined) task.project = input.project;
    if (input.priority !== undefined) task.priority = input.priority;
    if (input.status !== undefined) task.status = input.status;
    if (input.result !== undefined) task.result = input.result;

    task.updated_at = now;
    store.tasks[index] = task;
    this.storage.write(store);

    return task;
  }

  delete(id: string): boolean {
    const store = this.storage.read();
    const index = store.tasks.findIndex((t) => t.id === id);

    if (index === -1) {
      return false;
    }

    store.tasks.splice(index, 1);
    this.storage.write(store);
    return true;
  }

  get(id: string): Task | null {
    const store = this.storage.read();
    return store.tasks.find((t) => t.id === id) || null;
  }

  list(input: ListTasksInput = {}): Task[] {
    const store = this.storage.read();
    let tasks = store.tasks;

    if (!input.all) {
      const statusFilter = input.status ?? "pending";
      tasks = tasks.filter((t) => t.status === statusFilter);
    }

    if (input.project) {
      tasks = tasks.filter((t) => t.project === input.project);
    }

    if (input.query) {
      const q = input.query.toLowerCase();
      tasks = tasks.filter(
        (t) =>
          t.description.toLowerCase().includes(q) ||
          t.context.toLowerCase().includes(q)
      );
    }

    return tasks.toSorted((a, b) => a.priority - b.priority);
  }

  listProjects(): Array<{ project: string; pending: number; completed: number }> {
    const store = this.storage.read();
    const projectMap = new Map<string, { pending: number; completed: number }>();

    for (const task of store.tasks) {
      const counts = projectMap.get(task.project) || { pending: 0, completed: 0 };
      if (task.status === "pending") {
        counts.pending++;
      } else {
        counts.completed++;
      }
      projectMap.set(task.project, counts);
    }

    return Array.from(projectMap.entries()).map(([project, counts]) => ({
      project,
      ...counts,
    }));
  }

  complete(id: string, result: string): Task | null {
    return this.update({
      id,
      status: "completed",
      result,
    });
  }

  getStoragePath(): string {
    return this.storage.getPath();
  }
}
