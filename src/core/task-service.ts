import { customAlphabet } from "nanoid";
import type { StorageEngine } from "./storage/index.js";
import { JsonlStorage, ArchiveStorage } from "./storage/index.js";
import { GitHubSyncService } from "./github/index.js";
import type { GitHubSyncConfig } from "./config.js";
import { isSyncStale, updateSyncState } from "./sync-state.js";
import type {
  Task,
  TaskStore,
  CreateTaskInput,
  UpdateTaskInput,
  ListTasksInput,
  ArchivedTask,
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
  isInProgress,
  collectDescendantIds,
  isDescendant,
  collectAncestors,
  getDepthFromParent,
  getMaxDescendantDepth,
  getDepth,
  getChildren,
  getIncompleteBlockers,
  getBlockedTasks,
} from "./task-relationships.js";

const generateId = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

/**
 * Type guard to check if a task is an ArchivedTask.
 * ArchivedTask has archived_at field, while Task does not.
 */
export function isArchivedTask(
  task: Task | ArchivedTask,
): task is ArchivedTask {
  return "archived_at" in task;
}

function isStorageEngine(obj: unknown): obj is StorageEngine {
  return (
    typeof obj === "object" &&
    obj !== null &&
    ("read" in obj || "readAsync" in obj)
  );
}

function resolveStorage(
  storage: StorageEngine | string | undefined,
): StorageEngine {
  if (typeof storage === "string" || storage === undefined) {
    return new JsonlStorage(storage);
  }
  return storage;
}

export interface TaskServiceOptions {
  storage?: StorageEngine | string;
  archiveStorage?: ArchiveStorage;
  syncService?: GitHubSyncService | null;
  syncConfig?: GitHubSyncConfig | null;
}

export class TaskService {
  private storage: StorageEngine;
  private archiveStorage: ArchiveStorage | null;
  private syncService: GitHubSyncService | null;
  private syncConfig: GitHubSyncConfig | null;

  constructor(options?: TaskServiceOptions | StorageEngine | string) {
    // Handle backward compatibility with old constructor signatures
    if (typeof options === "string" || options === undefined) {
      this.storage = new JsonlStorage(options);
      this.archiveStorage = null;
      this.syncService = null;
      this.syncConfig = null;
    } else if (isStorageEngine(options)) {
      this.storage = options;
      this.archiveStorage = null;
      this.syncService = null;
      this.syncConfig = null;
    } else {
      this.storage = resolveStorage(options.storage);
      this.archiveStorage = options.archiveStorage ?? null;
      this.syncService = options.syncService ?? null;
      this.syncConfig = options.syncConfig ?? null;
    }
  }

  /**
   * Get archive storage, creating a default one if not provided.
   */
  private getArchiveStorage(): ArchiveStorage {
    if (this.archiveStorage) return this.archiveStorage;
    // Create archive storage using the same path as the main storage
    return new ArchiveStorage({ path: this.storage.getIdentifier() });
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
      const result = await this.syncService.syncTask(task, store);

      // Save GitHub metadata to task (skip if sync was skipped or no result)
      if (result && !result.skipped) {
        const taskIndex = store.tasks.findIndex((t) => t.id === result.taskId);
        if (taskIndex !== -1) {
          const targetTask = store.tasks[taskIndex];
          store.tasks[taskIndex] = {
            ...targetTask,
            metadata: {
              ...targetTask.metadata,
              github: result.github,
            },
            updated_at: new Date().toISOString(),
          };
          await this.storage.writeAsync(store);
        }
      }

      updateSyncState(this.storage.getIdentifier(), {
        lastSync: new Date().toISOString(),
      });
    } catch (err) {
      console.warn(
        "GitHub sync failed:",
        err instanceof Error ? err.message : err,
      );
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
          "Use a different ID or omit to auto-generate",
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
        throw new NotFoundError(
          "Task",
          input.parent_id,
          "The specified parent task does not exist",
        );
      }
      // Validate depth: maximum 3 levels (epic → task → subtask)
      const newDepth = getDepthFromParent(store.tasks, input.parent_id) + 1;
      if (newDepth > 3) {
        throw new ValidationError(
          "Cannot create subtask: maximum depth (3 levels) reached",
          "Tasks can only be nested 3 levels deep (epic → task → subtask)",
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
          throw new NotFoundError(
            "Task",
            blockerId,
            "The specified blocker task does not exist",
          );
        }
        if (!blockedBy.includes(blockerId)) {
          blockedBy.push(blockerId);
        }
      }
    }

    const task: Task = {
      id: taskId,
      parent_id: parentId,
      name: input.name,
      description: input.description ?? "",
      priority: input.priority ?? 1,
      completed: input.completed ?? false,
      result: input.result ?? null,
      metadata: input.metadata ?? null,
      created_at: input.created_at ?? now,
      updated_at: input.updated_at ?? now,
      started_at: input.started_at ?? null,
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

    if (input.name !== undefined) task.name = input.name;
    if (input.description !== undefined) task.description = input.description;
    if (input.parent_id !== undefined) {
      if (input.parent_id !== null) {
        // Validate new parent exists and isn't self or descendant
        if (input.parent_id === input.id) {
          throw new ValidationError(
            "Task cannot be its own parent",
            "Choose a different task as the parent",
          );
        }
        const parent = store.tasks.find((t) => t.id === input.parent_id);
        if (!parent) {
          throw new NotFoundError(
            "Task",
            input.parent_id,
            "The specified parent task does not exist",
          );
        }
        // Check for cycles: new parent can't be a descendant
        if (isDescendant(store.tasks, input.parent_id, input.id)) {
          throw new ValidationError(
            "Cannot set parent: would create a cycle",
            "The selected parent is already a subtask of this task",
          );
        }
        // Validate depth: maximum 3 levels (epic → task → subtask)
        // Need to check that this task + its descendants won't exceed depth limit
        const newDepth = getDepthFromParent(store.tasks, input.parent_id) + 1;
        const maxDescendantDepth = getMaxDescendantDepth(store.tasks, input.id);
        if (newDepth + maxDescendantDepth > 3) {
          throw new ValidationError(
            "Cannot move task: would exceed maximum depth (3 levels)",
            "Tasks can only be nested 3 levels deep (epic → task → subtask)",
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
    if (input.started_at !== undefined) task.started_at = input.started_at;
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
            "Remove the task's own ID from the add_blocked_by list",
          );
        }

        // Check blocker exists
        const blocker = store.tasks.find((t) => t.id === blockerId);
        if (!blocker) {
          throw new NotFoundError(
            "Task",
            blockerId,
            "The specified blocker task does not exist",
          );
        }

        // Check for cycles
        if (wouldCreateBlockingCycle(store.tasks, blockerId, input.id)) {
          throw new ValidationError(
            `Cannot add blocker ${blockerId}: would create a cycle`,
            "The specified task is already blocked by this task (directly or indirectly)",
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
    return getChildren(store.tasks, id);
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
    const store = await this.storage.readAsync();
    return getDepth(store.tasks, id);
  }

  async get(id: string): Promise<Task | null> {
    const store = await this.storage.readAsync();
    return store.tasks.find((t) => t.id === id) || null;
  }

  /**
   * Get a task by ID, checking archive if not found in active tasks.
   * Returns Task, ArchivedTask, or null.
   */
  async getWithArchive(id: string): Promise<Task | ArchivedTask | null> {
    // First check active tasks
    const task = await this.get(id);
    if (task) return task;

    // Check archive
    const archiveStorage = this.getArchiveStorage();
    return archiveStorage.getArchived(id) ?? null;
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
          t.name.toLowerCase().includes(q) ||
          (t.description && t.description.toLowerCase().includes(q)),
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

    // Filter by in-progress status: tasks that have been started but not completed
    if (input.in_progress === true) {
      tasks = tasks.filter(isInProgress);
    }

    return tasks.toSorted((a, b) => a.priority - b.priority);
  }

  /**
   * List archived tasks with optional query filter.
   */
  listArchived(query?: string): ArchivedTask[] {
    return this.getArchiveStorage().list(query);
  }

  /**
   * Search tasks by query, optionally including archived tasks.
   * @param query Search query to match against name and description/result
   * @param options Search options
   * @returns Array of active tasks and optionally archived tasks
   */
  async search(
    query: string,
    options: { includeArchive?: boolean } = {},
  ): Promise<Array<Task | ArchivedTask>> {
    const results: Array<Task | ArchivedTask> = [];

    // Search active tasks
    const activeTasks = await this.list({ all: true, query });
    results.push(...activeTasks);

    // Search archived tasks if requested
    if (options.includeArchive) {
      const archivedTasks = this.getArchiveStorage().list(query);
      results.push(...archivedTasks);
    }

    return results;
  }

  async complete(
    id: string,
    result: string,
    metadata?: Task["metadata"],
  ): Promise<Task> {
    const store = await this.storage.readAsync();

    // Collect all descendants, not just immediate children
    const descendants = new Set<string>();
    collectDescendantIds(store.tasks, id, descendants);

    const pendingDescendants = store.tasks.filter(
      (t) => descendants.has(t.id) && !t.completed,
    );

    if (pendingDescendants.length > 0) {
      throw new ValidationError(
        `Cannot complete: ${pendingDescendants.length} subtask${pendingDescendants.length > 1 ? "s" : ""} still pending`,
        "Complete or delete all subtasks first",
      );
    }

    // Auto-set started_at if task was never started
    const task = store.tasks.find((t) => t.id === id);
    const now = new Date().toISOString();
    const started_at = task && !task.started_at ? now : undefined;

    return await this.update({
      id,
      completed: true,
      result,
      metadata,
      started_at,
    });
  }

  /**
   * Mark a task as in progress (started).
   * @param id The task ID to start
   * @param options Options for starting the task
   * @param options.force If true, allows re-starting an already-started task
   * @returns The updated task
   * @throws NotFoundError if the task does not exist
   * @throws ValidationError if the task is already completed or already started (without force)
   */
  async start(id: string, options?: { force?: boolean }): Promise<Task> {
    const store = await this.storage.readAsync();
    const task = store.tasks.find((t) => t.id === id);

    if (!task) {
      throw new NotFoundError("Task", id);
    }

    if (task.completed) {
      throw new ValidationError(
        "Cannot start a completed task",
        "Use `dex edit` to uncomplete the task first if needed",
      );
    }

    if (task.started_at && !options?.force) {
      throw new ValidationError(
        "Task is already in progress and may be being worked on by someone else",
        "Use --force to re-claim the task",
      );
    }

    const now = new Date().toISOString();
    return await this.update({
      id,
      started_at: now,
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
    return getIncompleteBlockers(store.tasks, task);
  }

  /**
   * Get tasks that this task is blocking (that depend on this task).
   */
  async getBlockedTasks(id: string): Promise<Task[]> {
    const store = await this.storage.readAsync();
    const task = store.tasks.find((t) => t.id === id);
    if (!task) return [];
    return getBlockedTasks(store.tasks, task);
  }

  getStoragePath(): string {
    return this.storage.getIdentifier();
  }
}
