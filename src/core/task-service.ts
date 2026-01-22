import { customAlphabet } from "nanoid";
import { StorageEngine } from "./storage-engine.js";
import { FileStorage } from "./storage.js";
import {
  Task,
  CreateTaskInput,
  UpdateTaskInput,
  ListTasksInput,
} from "../types.js";
import { NotFoundError, ValidationError } from "../errors.js";

const generateId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

export class TaskService {
  private storage: StorageEngine;

  constructor(storage?: StorageEngine | string) {
    // Accept either a StorageEngine instance or a path string for backward compatibility
    if (typeof storage === "string" || storage === undefined) {
      this.storage = new FileStorage(storage);
    } else {
      this.storage = storage;
    }
  }

  create(input: CreateTaskInput): Task {
    const store = this.storage.read();
    const now = new Date().toISOString();

    let parentId: string | null = null;

    if (input.parent_id) {
      const parent = store.tasks.find((t) => t.id === input.parent_id);
      if (!parent) {
        throw new NotFoundError("Task", input.parent_id, "The specified parent task does not exist");
      }
      parentId = input.parent_id;
    }

    const task: Task = {
      id: generateId(),
      parent_id: parentId,
      description: input.description,
      context: input.context,
      priority: input.priority ?? 1,
      status: "pending",
      result: null,
      created_at: now,
      updated_at: now,
      completed_at: null,
    };

    store.tasks.push(task);
    this.storage.write(store);

    return task;
  }

  update(input: UpdateTaskInput): Task {
    if (input.delete) {
      return this.delete(input.id);
    }

    const store = this.storage.read();
    const index = store.tasks.findIndex((t) => t.id === input.id);

    if (index === -1) {
      throw new NotFoundError("Task", input.id);
    }

    const task = store.tasks[index];
    const now = new Date().toISOString();

    if (input.description !== undefined) task.description = input.description;
    if (input.context !== undefined) task.context = input.context;
    if (input.parent_id !== undefined) {
      if (input.parent_id !== null) {
        // Validate new parent exists and isn't self or descendant
        if (input.parent_id === input.id) {
          throw new ValidationError(
            "Task cannot be its own parent",
            "Choose a different task as the parent"
          );
        }
        const parent = store.tasks.find((t) => t.id === input.parent_id);
        if (!parent) {
          throw new NotFoundError("Task", input.parent_id, "The specified parent task does not exist");
        }
        // Check for cycles: new parent can't be a descendant
        if (this.isDescendant(store.tasks, input.parent_id, input.id)) {
          throw new ValidationError(
            "Cannot set parent: would create a cycle",
            "The selected parent is already a subtask of this task"
          );
        }
      }
      task.parent_id = input.parent_id;
    }
    if (input.priority !== undefined) task.priority = input.priority;
    if (input.status !== undefined) {
      // Handle completed_at timestamp based on status transition
      if (input.status === "completed" && task.status !== "completed") {
        task.completed_at = now;
      } else if (input.status === "pending" && task.status === "completed") {
        task.completed_at = null;
      }
      task.status = input.status;
    }
    if (input.result !== undefined) task.result = input.result;

    task.updated_at = now;
    store.tasks[index] = task;
    this.storage.write(store);

    return task;
  }

  /**
   * Delete a task and all its descendants.
   * @param id The task ID to delete
   * @returns The deleted task
   * @throws NotFoundError if the task does not exist
   */
  delete(id: string): Task {
    const store = this.storage.read();
    const index = store.tasks.findIndex((t) => t.id === id);

    if (index === -1) {
      throw new NotFoundError("Task", id);
    }

    const deletedTask = store.tasks[index];

    // Cascade delete all descendants
    const toDelete = new Set<string>([id]);
    this.collectDescendants(store.tasks, id, toDelete);

    store.tasks = store.tasks.filter((t) => !toDelete.has(t.id));
    this.storage.write(store);
    return deletedTask;
  }

  getChildren(id: string): Task[] {
    const store = this.storage.read();
    return store.tasks.filter((t) => t.parent_id === id);
  }

  private collectDescendants(tasks: Task[], parentId: string, result: Set<string>): void {
    for (const task of tasks) {
      if (task.parent_id === parentId && !result.has(task.id)) {
        result.add(task.id);
        this.collectDescendants(tasks, task.id, result);
      }
    }
  }

  private isDescendant(tasks: Task[], potentialDescendant: string, ancestorId: string): boolean {
    const task = tasks.find((t) => t.id === potentialDescendant);
    if (!task || !task.parent_id) return false;
    if (task.parent_id === ancestorId) return true;
    return this.isDescendant(tasks, task.parent_id, ancestorId);
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

  complete(id: string, result: string): Task {
    const store = this.storage.read();

    // Collect all descendants, not just immediate children
    const descendants = new Set<string>();
    this.collectDescendants(store.tasks, id, descendants);

    const pendingDescendants = store.tasks.filter(
      (t) => descendants.has(t.id) && t.status === "pending"
    );

    if (pendingDescendants.length > 0) {
      throw new ValidationError(
        `Cannot complete: ${pendingDescendants.length} subtask${pendingDescendants.length > 1 ? "s" : ""} still pending`,
        "Complete or delete all subtasks first"
      );
    }

    return this.update({
      id,
      status: "completed",
      result,
    });
  }

  getStoragePath(): string {
    return this.storage.getIdentifier();
  }
}
