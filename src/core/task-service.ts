import { customAlphabet } from "nanoid";
import { StorageEngine } from "./storage-engine.js";
import { FileStorage } from "./storage.js";
import {
  Task,
  TaskStore,
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

  // ============ Bidirectional Sync Helpers ============

  /**
   * Sync parent-child relationship (bidirectional).
   * Updates: parent.children[] ↔ child.parent_id
   */
  private syncParentChild(
    store: TaskStore,
    childId: string,
    oldParentId: string | null,
    newParentId: string | null
  ): void {
    // Remove from old parent's children[]
    if (oldParentId) {
      const oldParent = store.tasks.find((t) => t.id === oldParentId);
      if (oldParent) {
        oldParent.children = oldParent.children.filter((id) => id !== childId);
      }
    }

    // Add to new parent's children[]
    if (newParentId) {
      const newParent = store.tasks.find((t) => t.id === newParentId);
      if (!newParent) throw new NotFoundError("Task", newParentId, "The specified parent task does not exist");
      if (!newParent.children.includes(childId)) {
        newParent.children.push(childId);
      }
    }
  }

  /**
   * Add blocking relationship (bidirectional).
   * Updates: blocker.blocks[] ↔ blocked.blockedBy[]
   */
  private syncAddBlocker(store: TaskStore, blockerId: string, blockedId: string): void {
    // Validate blocker exists
    const blocker = store.tasks.find((t) => t.id === blockerId);
    if (!blocker) throw new NotFoundError("Task", blockerId, "The specified blocker task does not exist");

    // Update blocker's blocks[] (add blockedId)
    if (!blocker.blocks.includes(blockedId)) {
      blocker.blocks.push(blockedId);
    }

    // Update blocked's blockedBy[] (add blockerId)
    const blocked = store.tasks.find((t) => t.id === blockedId);
    if (blocked && !blocked.blockedBy.includes(blockerId)) {
      blocked.blockedBy.push(blockerId);
    }
  }

  /**
   * Remove blocking relationship (bidirectional).
   */
  private syncRemoveBlocker(store: TaskStore, blockerId: string, blockedId: string): void {
    // Update blocker's blocks[] (remove blockedId)
    const blocker = store.tasks.find((t) => t.id === blockerId);
    if (blocker) {
      blocker.blocks = blocker.blocks.filter((id) => id !== blockedId);
    }

    // Update blocked's blockedBy[] (remove blockerId)
    const blocked = store.tasks.find((t) => t.id === blockedId);
    if (blocked) {
      blocked.blockedBy = blocked.blockedBy.filter((id) => id !== blockerId);
    }
  }

  /**
   * Clean up all references to a deleted task.
   */
  private cleanupTaskReferences(store: TaskStore, taskId: string): void {
    for (const task of store.tasks) {
      task.children = task.children.filter((id) => id !== taskId);
      task.blockedBy = task.blockedBy.filter((id) => id !== taskId);
      task.blocks = task.blocks.filter((id) => id !== taskId);
    }
  }

  /**
   * Check if adding blocker→blocked would create a cycle.
   * A cycle exists if 'blocked' is already in blocker's dependency chain.
   */
  private wouldCreateBlockingCycle(
    tasks: Task[],
    blockerId: string,
    blockedId: string
  ): boolean {
    const visited = new Set<string>();
    const stack = [blockerId];

    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === blockedId) return true; // Cycle found!
      if (visited.has(current)) continue;
      visited.add(current);

      const task = tasks.find((t) => t.id === current);
      if (task?.blockedBy) {
        stack.push(...task.blockedBy);
      }
    }
    return false;
  }

  /**
   * Check if a task is blocked (has any incomplete tasks in blockedBy).
   */
  isBlocked(tasks: Task[], task: Task): boolean {
    return task.blockedBy.some((blockerId) => {
      const blocker = tasks.find((t) => t.id === blockerId);
      return blocker && !blocker.completed;
    });
  }

  /**
   * Check if a task is ready (pending with all blockers completed or empty blockedBy).
   */
  isReady(tasks: Task[], task: Task): boolean {
    if (task.completed) return false;
    return !this.isBlocked(tasks, task);
  }

  // ============ CRUD Methods ============

  async create(input: CreateTaskInput): Promise<Task> {
    const store = await this.storage.readAsync();
    const now = new Date().toISOString();

    let parentId: string | null = null;

    if (input.parent_id) {
      const parent = store.tasks.find((t) => t.id === input.parent_id);
      if (!parent) {
        throw new NotFoundError("Task", input.parent_id, "The specified parent task does not exist");
      }
      // Validate depth: maximum 3 levels (epic → task → subtask)
      const newDepth = this.getDepthFromParent(store.tasks, input.parent_id) + 1;
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
      id: generateId(),
      parent_id: parentId,
      description: input.description,
      context: input.context,
      priority: input.priority ?? 1,
      completed: false,
      result: null,
      metadata: null,
      created_at: now,
      updated_at: now,
      completed_at: null,
      blockedBy: [],
      blocks: [],
      children: [],
    };

    store.tasks.push(task);

    // Sync parent-child relationship
    if (parentId) {
      this.syncParentChild(store, task.id, null, parentId);
    }

    // Sync blocking relationships
    for (const blockerId of blockedBy) {
      this.syncAddBlocker(store, blockerId, task.id);
    }

    await this.storage.writeAsync(store);

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
        if (this.isDescendant(store.tasks, input.parent_id, input.id)) {
          throw new ValidationError(
            "Cannot set parent: would create a cycle",
            "The selected parent is already a subtask of this task"
          );
        }
        // Validate depth: maximum 3 levels (epic → task → subtask)
        // Need to check that this task + its descendants won't exceed depth limit
        const newDepth = this.getDepthFromParent(store.tasks, input.parent_id) + 1;
        const maxDescendantDepth = this.getMaxDescendantDepth(store.tasks, input.id);
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
        this.syncParentChild(store, task.id, oldParentId, input.parent_id);
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
        if (this.wouldCreateBlockingCycle(store.tasks, blockerId, input.id)) {
          throw new ValidationError(
            `Cannot add blocker ${blockerId}: would create a cycle`,
            "The specified task is already blocked by this task (directly or indirectly)"
          );
        }

        // Sync the relationship
        this.syncAddBlocker(store, blockerId, input.id);
      }
    }

    // Handle remove_blocked_by
    if (input.remove_blocked_by && input.remove_blocked_by.length > 0) {
      for (const blockerId of input.remove_blocked_by) {
        this.syncRemoveBlocker(store, blockerId, input.id);
      }
    }

    task.updated_at = now;
    store.tasks[index] = task;
    await this.storage.writeAsync(store);

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
    this.collectDescendants(store.tasks, id, toDelete);

    // Clean up references to all deleted tasks
    for (const taskId of toDelete) {
      this.cleanupTaskReferences(store, taskId);
    }

    store.tasks = store.tasks.filter((t) => !toDelete.has(t.id));
    await this.storage.writeAsync(store);
    return deletedTask;
  }

  async getChildren(id: string): Promise<Task[]> {
    const store = await this.storage.readAsync();
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

  /**
   * Get the ancestors of a task, from root to immediate parent.
   * Returns an empty array for root-level tasks.
   */
  async getAncestors(id: string): Promise<Task[]> {
    const store = await this.storage.readAsync();
    return this.collectAncestors(store.tasks, id);
  }

  private collectAncestors(tasks: Task[], id: string): Task[] {
    const task = tasks.find((t) => t.id === id);
    if (!task || !task.parent_id) return [];

    const parent = tasks.find((t) => t.id === task.parent_id);
    if (!parent) return [];

    // Recursively get ancestors of the parent, then append parent
    return [...this.collectAncestors(tasks, parent.id), parent];
  }

  /**
   * Get the nesting depth of a task.
   * 0 = root (epic), 1 = task under epic, 2 = subtask
   */
  async getDepth(id: string): Promise<number> {
    const ancestors = await this.getAncestors(id);
    return ancestors.length;
  }

  /**
   * Calculate depth from a parent ID (for validation during creation).
   * Returns the depth a new child would have if created under this parent.
   */
  private getDepthFromParent(tasks: Task[], parentId: string): number {
    const ancestors = this.collectAncestors(tasks, parentId);
    return ancestors.length + 1; // +1 because the new task will be one level below parent
  }

  /**
   * Get the maximum depth of descendants relative to a task.
   * Returns 0 if the task has no children, 1 if it has children but no grandchildren, etc.
   */
  private getMaxDescendantDepth(tasks: Task[], taskId: string): number {
    const children = tasks.filter((t) => t.parent_id === taskId);
    if (children.length === 0) return 0;
    return 1 + Math.max(...children.map((c) => this.getMaxDescendantDepth(tasks, c.id)));
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
      tasks = tasks.filter((t) => this.isBlocked(store.tasks, t));
    }

    // Filter by ready status: pending tasks with all blockers completed (or none)
    if (input.ready === true) {
      tasks = tasks.filter((t) => this.isReady(store.tasks, t));
    }

    return tasks.toSorted((a, b) => a.priority - b.priority);
  }

  async complete(id: string, result: string, metadata?: Task["metadata"]): Promise<Task> {
    const store = await this.storage.readAsync();

    // Collect all descendants, not just immediate children
    const descendants = new Set<string>();
    this.collectDescendants(store.tasks, id, descendants);

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
