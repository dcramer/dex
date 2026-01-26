import { customAlphabet } from "nanoid";
import { StorageEngine, FileStorage } from "./storage/index.js";
import { GitHubSyncService } from "./github/index.js";
import { GitHubSyncConfig } from "./config.js";
import { isSyncStale, updateSyncState } from "./sync-state.js";
import {
  Task,
  TaskStore,
  CreateTaskInput,
  UpdateTaskInput,
  ListTasksInput,
} from "../types.js";
import { NotFoundError, ValidationError } from "../errors.js";
import {
  syncParentChild,
  syncAddBlocker,
  syncRemoveBlocker,
  cleanupTaskReferences,
  wouldCreateBlockingCycle,
  isBlocked,
  isReady,
  collectDescendantIds,
  isDescendant,
  collectAncestors,
  getDepthFromParent,
  getMaxDescendantDepth,
} from "./task-relationships.js";

const generateId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

function isStorageEngine(obj: unknown): obj is StorageEngine {
  return (
    typeof obj === "object" &&
    obj !== null &&
    ("read" in obj || "readAsync" in obj)
  );
}

function resolveStorage(storage: StorageEngine | string | undefined): StorageEngine {
  if (typeof storage === "string" || storage === undefined) {
    return new FileStorage(storage);
  }
  return storage;
}

export interface TaskServiceOptions {
  storage?: StorageEngine | string;
  syncService?: GitHubSyncService | null;
  syncConfig?: GitHubSyncConfig | null;
}

export class TaskService {
  private storage: StorageEngine;
  private syncService: GitHubSyncService | null;
  private syncConfig: GitHubSyncConfig | null;

  constructor(options?: TaskServiceOptions | StorageEngine | string) {
    // Handle backward compatibility with old constructor signatures
    if (typeof options === "string" || options === undefined) {
      this.storage = new FileStorage(options);
      this.syncService = null;
      this.syncConfig = null;
    } else if (isStorageEngine(options)) {
      this.storage = options;
      this.syncService = null;
      this.syncConfig = null;
    } else {
      this.storage = resolveStorage(options.storage);
      this.syncService = options.syncService ?? null;
      this.syncConfig = options.syncConfig ?? null;
    }
  }

  /**
   * Sync a task to GitHub if sync service is configured.
   * Respects auto-sync settings (on_change and max_age).
   * Errors are caught and logged but don't fail the operation.
   */
  private async syncToGitHub(task: Task): Promise<void> {
    if (!this.syncService) return;

    const autoConfig = this.syncConfig?.auto;
    const onChange = autoConfig?.on_change !== false; // default: true

    if (onChange) {
      // Sync immediately
      await this.doSync(task);
      return;
    }

    // on_change is false - check max_age
    const maxAge = autoConfig?.max_age;
    if (maxAge && isSyncStale(this.storage.getIdentifier(), maxAge)) {
      await this.doSync(task);
    }
  }

  /**
   * Perform the actual sync to GitHub and update sync state.
   */
  private async doSync(task: Task): Promise<void> {
    if (!this.syncService) return;

    try {
      const store = await this.storage.readAsync();
      await this.syncService.syncTask(task, store);
      updateSyncState(this.storage.getIdentifier(), { lastSync: new Date().toISOString() });
    } catch (err) {
      console.warn("GitHub sync failed:", err instanceof Error ? err.message : err);
    }
  }

  // ============ CRUD Methods ============

  async create(input: CreateTaskInput): Promise<Task> {
    const store = await this.storage.readAsync();
    const now = new Date().toISOString();

    // Handle optional ID (for import/restore scenarios)
    let taskId: string;
    if (input.id) {
      const existing = store.tasks.find((t) => t.id === input.id);
      if (existing) {
        throw new ValidationError(
          `Task with ID '${input.id}' already exists`,
          "Use a different ID or omit to auto-generate"
        );
      }
      taskId = input.id;
    } else {
      taskId = generateId();
    }

    let parentId: string | null = null;

    if (input.parent_id) {
      const parent = store.tasks.find((t) => t.id === input.parent_id);
      if (!parent) {
        throw new NotFoundError("Task", input.parent_id, "The specified parent task does not exist");
      }
      // Validate depth: maximum 3 levels (epic → task → subtask)
      const newDepth = getDepthFromParent(store.tasks, input.parent_id) + 1;
      if (newDepth > 3) {
        throw new ValidationError(
          "Cannot create subtask: maximum depth (3 levels) reached",
          "Tasks can only be nested 3 levels deep (epic → task → subtask)"
        );
      }
      parentId = input.parent_id;
    }

    // Validate blocked_by IDs exist and dedupe
    const blockedBy: string[] = [];
    if (input.blocked_by && input.blocked_by.length > 0) {
      for (const blockerId of input.blocked_by) {
        const blocker = store.tasks.find((t) => t.id === blockerId);
        if (!blocker) {
          throw new NotFoundError("Task", blockerId, "The specified blocker task does not exist");
        }
        if (!blockedBy.includes(blockerId)) {
          blockedBy.push(blockerId);
        }
      }
    }

    const task: Task = {
      id: taskId,
      parent_id: parentId,
      description: input.description,
      context: input.context,
      priority: input.priority ?? 1,
      completed: input.completed ?? false,
      result: input.result ?? null,
      metadata: input.metadata ?? null,
      created_at: input.created_at ?? now,
      updated_at: input.updated_at ?? now,
      completed_at: input.completed_at ?? null,
      blockedBy: [],
      blocks: [],
      children: [],
    };

    store.tasks.push(task);

    // Sync parent-child relationship
    if (parentId) {
      syncParentChild(store, task.id, null, parentId);
    }

    // Sync blocking relationships
    for (const blockerId of blockedBy) {
      syncAddBlocker(store, blockerId, task.id);
    }

    await this.storage.writeAsync(store);

    // Sync to GitHub if enabled
    await this.syncToGitHub(task);

    return task;
  }

  async update(input: UpdateTaskInput): Promise<Task> {
    if (input.delete) {
      return await this.delete(input.id);
    }

    const store = await this.storage.readAsync();
    const index = store.tasks.findIndex((t) => t.id === input.id);

    if (index === -1) {
      throw new NotFoundError("Task", input.id);
    }

    const task = store.tasks[index];
    const oldParentId = task.parent_id;
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
        if (isDescendant(store.tasks, input.parent_id, input.id)) {
          throw new ValidationError(
            "Cannot set parent: would create a cycle",
            "The selected parent is already a subtask of this task"
          );
        }
        // Validate depth: maximum 3 levels (epic → task → subtask)
        // Need to check that this task + its descendants won't exceed depth limit
        const newDepth = getDepthFromParent(store.tasks, input.parent_id) + 1;
        const maxDescendantDepth = getMaxDescendantDepth(store.tasks, input.id);
        if (newDepth + maxDescendantDepth > 3) {
          throw new ValidationError(
            "Cannot move task: would exceed maximum depth (3 levels)",
            "Tasks can only be nested 3 levels deep (epic → task → subtask)"
          );
        }
      }
      task.parent_id = input.parent_id;

      // Sync parent-child relationship if parent changed
      if (oldParentId !== input.parent_id) {
        syncParentChild(store, task.id, oldParentId, input.parent_id);
      }
    }
    if (input.priority !== undefined) task.priority = input.priority;
    if (input.completed !== undefined) {
      // Handle completed_at timestamp based on completion transition
      if (input.completed && !task.completed) {
        task.completed_at = now;
      } else if (!input.completed && task.completed) {
        task.completed_at = null;
      }
      task.completed = input.completed;
    }
    if (input.result !== undefined) task.result = input.result;
    if (input.metadata !== undefined) {
      task.metadata = input.metadata;
    }

    // Handle add_blocked_by
    if (input.add_blocked_by && input.add_blocked_by.length > 0) {
      for (const blockerId of input.add_blocked_by) {
        // Check self-blocking
        if (blockerId === input.id) {
          throw new ValidationError(
            "Task cannot block itself",
            "Remove the task's own ID from the add_blocked_by list"
          );
        }

        // Check blocker exists
        const blocker = store.tasks.find((t) => t.id === blockerId);
        if (!blocker) {
          throw new NotFoundError("Task", blockerId, "The specified blocker task does not exist");
        }

        // Check for cycles
        if (wouldCreateBlockingCycle(store.tasks, blockerId, input.id)) {
          throw new ValidationError(
            `Cannot add blocker ${blockerId}: would create a cycle`,
            "The specified task is already blocked by this task (directly or indirectly)"
          );
        }

        // Sync the relationship
        syncAddBlocker(store, blockerId, input.id);
      }
    }

    // Handle remove_blocked_by
    if (input.remove_blocked_by && input.remove_blocked_by.length > 0) {
      for (const blockerId of input.remove_blocked_by) {
        syncRemoveBlocker(store, blockerId, input.id);
      }
    }

    task.updated_at = now;
    store.tasks[index] = task;
    await this.storage.writeAsync(store);

    // Sync to GitHub if enabled
    await this.syncToGitHub(task);

    return task;
  }

  /**
   * Delete a task and all its descendants.
   * @param id The task ID to delete
   * @returns The deleted task
   * @throws NotFoundError if the task does not exist
   */
  async delete(id: string): Promise<Task> {
    const store = await this.storage.readAsync();
    const index = store.tasks.findIndex((t) => t.id === id);

    if (index === -1) {
      throw new NotFoundError("Task", id);
    }

    const deletedTask = store.tasks[index];

    // Cascade delete all descendants
    const toDelete = new Set<string>([id]);
    collectDescendantIds(store.tasks, id, toDelete);

    // Clean up references to all deleted tasks
    for (const taskId of toDelete) {
      cleanupTaskReferences(store, taskId);
    }

    store.tasks = store.tasks.filter((t) => !toDelete.has(t.id));
    await this.storage.writeAsync(store);
    return deletedTask;
  }

  async getChildren(id: string): Promise<Task[]> {
    const store = await this.storage.readAsync();
    return store.tasks.filter((t) => t.parent_id === id);
  }

  /**
   * Get the ancestors of a task, from root to immediate parent.
   * Returns an empty array for root-level tasks.
   */
  async getAncestors(id: string): Promise<Task[]> {
    const store = await this.storage.readAsync();
    return collectAncestors(store.tasks, id);
  }

  /**
   * Get the nesting depth of a task.
   * 0 = root (epic), 1 = task under epic, 2 = subtask
   */
  async getDepth(id: string): Promise<number> {
    const ancestors = await this.getAncestors(id);
    return ancestors.length;
  }

  async get(id: string): Promise<Task | null> {
    const store = await this.storage.readAsync();
    return store.tasks.find((t) => t.id === id) || null;
  }

  async list(input: ListTasksInput = {}): Promise<Task[]> {
    const store = await this.storage.readAsync();
    let tasks = store.tasks;

    if (!input.all) {
      // Default to showing non-completed (pending) tasks
      const completedFilter = input.completed ?? false;
      tasks = tasks.filter((t) => t.completed === completedFilter);
    }

    if (input.query) {
      const q = input.query.toLowerCase();
      tasks = tasks.filter(
        (t) =>
          t.description.toLowerCase().includes(q) ||
          t.context.toLowerCase().includes(q)
      );
    }

    // Filter by blocked status: tasks that have incomplete blockers
    if (input.blocked === true) {
      tasks = tasks.filter((t) => isBlocked(store.tasks, t));
    }

    // Filter by ready status: pending tasks with all blockers completed (or none)
    if (input.ready === true) {
      tasks = tasks.filter((t) => isReady(store.tasks, t));
    }

    return tasks.toSorted((a, b) => a.priority - b.priority);
  }

  async complete(id: string, result: string, metadata?: Task["metadata"]): Promise<Task> {
    const store = await this.storage.readAsync();

    // Collect all descendants, not just immediate children
    const descendants = new Set<string>();
    collectDescendantIds(store.tasks, id, descendants);

    const pendingDescendants = store.tasks.filter(
      (t) => descendants.has(t.id) && !t.completed
    );

    if (pendingDescendants.length > 0) {
      throw new ValidationError(
        `Cannot complete: ${pendingDescendants.length} subtask${pendingDescendants.length > 1 ? "s" : ""} still pending`,
        "Complete or delete all subtasks first"
      );
    }

    return await this.update({
      id,
      completed: true,
      result,
      metadata,
    });
  }

  /**
   * Get incomplete blockers for a task.
   * Returns an array of tasks that are blocking this one (not yet completed).
   */
  async getIncompleteBlockers(id: string): Promise<Task[]> {
    const store = await this.storage.readAsync();
    const task = store.tasks.find((t) => t.id === id);
    if (!task) return [];

    return task.blockedBy
      .map((blockerId) => store.tasks.find((t) => t.id === blockerId))
      .filter((t): t is Task => t !== undefined && !t.completed);
  }

  /**
   * Get tasks that this task is blocking (that depend on this task).
   */
  async getBlockedTasks(id: string): Promise<Task[]> {
    const store = await this.storage.readAsync();
    const task = store.tasks.find((t) => t.id === id);
    if (!task) return [];

    return task.blocks
      .map((blockedId) => store.tasks.find((t) => t.id === blockedId))
      .filter((t): t is Task => t !== undefined && !t.completed);
  }

  getStoragePath(): string {
    return this.storage.getIdentifier();
  }
}
