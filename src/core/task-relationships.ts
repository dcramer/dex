import { Task, TaskStore } from "../types.js";
import { NotFoundError } from "../errors.js";

/**
 * Sync parent-child relationship (bidirectional).
 * Updates: parent.children[] ↔ child.parent_id
 */
export function syncParentChild(
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
export function syncAddBlocker(store: TaskStore, blockerId: string, blockedId: string): void {
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
export function syncRemoveBlocker(store: TaskStore, blockerId: string, blockedId: string): void {
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
export function cleanupTaskReferences(store: TaskStore, taskId: string): void {
  for (const task of store.tasks) {
    task.children = task.children.filter((id) => id !== taskId);
    task.blockedBy = task.blockedBy.filter((id) => id !== taskId);
    task.blocks = task.blocks.filter((id) => id !== taskId);
  }
}

/**
 * Check if adding blocker→blocked would create a cycle.
 * A cycle exists if 'blocked' is already in blocker's dependency chain.
 * Checks both blockedBy and blocks directions for robustness against data inconsistencies.
 */
export function wouldCreateBlockingCycle(
  tasks: Task[],
  blockerId: string,
  blockedId: string
): boolean {
  // Check if blockedId is already upstream of blockerId (via blockedBy chains)
  const visited = new Set<string>();
  const stack = [blockerId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === blockedId) return true; // Cycle found!
    if (visited.has(current)) continue;
    visited.add(current);

    const task = tasks.find((t) => t.id === current);
    if (task) {
      // Follow blockedBy: tasks that must complete before this one
      stack.push(...task.blockedBy);
    }
  }

  // Also check via blocks direction: if blockedId already blocks something
  // that transitively blocks blockerId
  const blockedTask = tasks.find((t) => t.id === blockedId);
  if (blockedTask) {
    const visitedBlocks = new Set<string>();
    const blocksStack = [...blockedTask.blocks];

    while (blocksStack.length > 0) {
      const current = blocksStack.pop()!;
      if (current === blockerId) return true; // Cycle found!
      if (visitedBlocks.has(current)) continue;
      visitedBlocks.add(current);

      const task = tasks.find((t) => t.id === current);
      if (task) {
        // Follow blocks: tasks this one must complete before
        blocksStack.push(...task.blocks);
      }
    }
  }

  return false;
}

/**
 * Get IDs of incomplete tasks that are blocking a given task.
 */
export function getIncompleteBlockerIds(tasks: Task[], task: Task): string[] {
  return task.blockedBy.filter((blockerId) => {
    const blocker = tasks.find((t) => t.id === blockerId);
    return blocker && !blocker.completed;
  });
}

/**
 * Check if a task is blocked (has any incomplete tasks in blockedBy).
 */
export function isBlocked(tasks: Task[], task: Task): boolean {
  return getIncompleteBlockerIds(tasks, task).length > 0;
}

/**
 * Check if a task has any incomplete children.
 */
export function hasIncompleteChildren(tasks: Task[], task: Task): boolean {
  return task.children.some((childId) => {
    const child = tasks.find((t) => t.id === childId);
    return child && !child.completed;
  });
}

/**
 * Check if a task is ready (pending with all blockers completed and no incomplete children).
 */
export function isReady(tasks: Task[], task: Task): boolean {
  if (task.completed) return false;
  if (isBlocked(tasks, task)) return false;
  if (hasIncompleteChildren(tasks, task)) return false;
  return true;
}

/**
 * Collect all descendant IDs of a task recursively into a Set.
 */
export function collectDescendantIds(tasks: Task[], parentId: string, result: Set<string>): void {
  for (const task of tasks) {
    if (task.parent_id === parentId && !result.has(task.id)) {
      result.add(task.id);
      collectDescendantIds(tasks, task.id, result);
    }
  }
}

/**
 * Check if potentialDescendant is a descendant of ancestorId.
 */
export function isDescendant(tasks: Task[], potentialDescendant: string, ancestorId: string): boolean {
  const task = tasks.find((t) => t.id === potentialDescendant);
  if (!task || !task.parent_id) return false;
  if (task.parent_id === ancestorId) return true;
  return isDescendant(tasks, task.parent_id, ancestorId);
}

/**
 * Collect ancestors of a task, from root to immediate parent.
 */
export function collectAncestors(tasks: Task[], id: string): Task[] {
  const task = tasks.find((t) => t.id === id);
  if (!task || !task.parent_id) return [];

  const parent = tasks.find((t) => t.id === task.parent_id);
  if (!parent) return [];

  // Recursively get ancestors of the parent, then append parent
  return [...collectAncestors(tasks, parent.id), parent];
}

/**
 * Calculate depth from a parent ID (for validation during creation).
 * Returns the depth a new child would have if created under this parent.
 */
export function getDepthFromParent(tasks: Task[], parentId: string): number {
  const ancestors = collectAncestors(tasks, parentId);
  return ancestors.length + 1; // +1 because the new task will be one level below parent
}

/**
 * Get the maximum depth of descendants relative to a task.
 * Returns 0 if the task has no children, 1 if it has children but no grandchildren, etc.
 */
export function getMaxDescendantDepth(tasks: Task[], taskId: string): number {
  const children = tasks.filter((t) => t.parent_id === taskId);
  if (children.length === 0) return 0;
  return 1 + Math.max(...children.map((c) => getMaxDescendantDepth(tasks, c.id)));
}
