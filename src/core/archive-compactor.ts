import { Task, ArchivedTask, ArchivedChild } from "../types.js";
import {
  collectDescendantIds,
  collectAncestors,
} from "./task-relationships.js";

export interface AutoArchiveConfig {
  /** Minimum age in days before a task can be auto-archived */
  minAgeDays: number;
  /** Maximum number of recent completed tasks to keep (not auto-archive) */
  keepRecentCount: number;
}

export const DEFAULT_AUTO_ARCHIVE_CONFIG: AutoArchiveConfig = {
  minAgeDays: 90,
  keepRecentCount: 50,
};

export interface CollectedArchiveTasks {
  /** The root task to archive */
  root: Task;
  /** All descendant tasks (children, grandchildren, etc.) */
  descendants: Task[];
}

/**
 * Convert a full Task to a compacted ArchivedTask.
 *
 * Strips: description (details), blockedBy, blocks, children, created_at, updated_at, priority
 * Preserves: id, parent_id, name, completed_at, result, metadata.github, metadata.commit
 * Adds: archived_at, archived_children (rolled up from children)
 *
 * @param task The task to compact
 * @param children Direct child tasks to roll up into archived_children
 * @returns Compacted ArchivedTask
 */
export function compactTask(task: Task, children: Task[] = []): ArchivedTask {
  const archivedChildren: ArchivedChild[] = children.map((child) => ({
    id: child.id,
    name: child.name,
    result: child.result,
  }));

  // Preserve only github and commit metadata, drop other fields
  const metadata: ArchivedTask["metadata"] =
    task.metadata?.github || task.metadata?.commit
      ? {
          ...(task.metadata.github && { github: task.metadata.github }),
          ...(task.metadata.commit && { commit: task.metadata.commit }),
        }
      : null;

  return {
    id: task.id,
    parent_id: task.parent_id,
    name: task.name,
    result: task.result,
    completed_at: task.completed_at,
    archived_at: new Date().toISOString(),
    metadata,
    archived_children: archivedChildren,
  };
}

/**
 * Collect a task and all its descendants for archival.
 * Validates that all collected tasks are completed and have no active ancestors.
 *
 * @param taskId The root task ID to archive
 * @param allTasks All tasks in the store
 * @returns Object with root task and descendants, or null if validation fails
 * @throws Error if task not found or validation fails
 */
export function collectArchivableTasks(
  taskId: string,
  allTasks: Task[],
): CollectedArchiveTasks | null {
  const root = allTasks.find((t) => t.id === taskId);
  if (!root) {
    return null;
  }

  // Root must be completed
  if (!root.completed) {
    return null;
  }

  // Collect all descendants
  const descendantIds = new Set<string>();
  collectDescendantIds(allTasks, taskId, descendantIds);

  const descendants = allTasks.filter((t) => descendantIds.has(t.id));

  // All descendants must be completed
  const incompleteDescendant = descendants.find((t) => !t.completed);
  if (incompleteDescendant) {
    return null;
  }

  // Check ancestors - none can be incomplete (active)
  const ancestors = collectAncestors(allTasks, taskId);
  const activeAncestor = ancestors.find((t) => !t.completed);
  if (activeAncestor) {
    return null;
  }

  return { root, descendants };
}

/**
 * Check if a task meets auto-archive criteria.
 *
 * Criteria:
 * - Task is completed
 * - All descendants are completed
 * - No active (incomplete) ancestors
 * - Task is older than config.minAgeDays
 * - Task is not in the most recent config.keepRecentCount completed tasks
 *
 * @param task The task to check
 * @param allTasks All tasks in the store
 * @param config Auto-archive configuration
 * @returns true if task can be auto-archived
 */
export function canAutoArchive(
  task: Task,
  allTasks: Task[],
  config: AutoArchiveConfig = DEFAULT_AUTO_ARCHIVE_CONFIG,
): boolean {
  // Must be completed
  if (!task.completed) {
    return false;
  }

  // Must have a completed_at timestamp
  if (!task.completed_at) {
    return false;
  }

  // Check age requirement
  const completedAt = new Date(task.completed_at);
  const now = new Date();
  const ageMs = now.getTime() - completedAt.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  if (ageDays < config.minAgeDays) {
    return false;
  }

  // Check if in recent completed tasks
  const completedTasks = allTasks
    .filter((t) => t.completed && t.completed_at)
    .sort((a, b) => {
      // Sort by completed_at descending (most recent first)
      const aTime = new Date(a.completed_at!).getTime();
      const bTime = new Date(b.completed_at!).getTime();
      return bTime - aTime;
    });

  const recentIds = new Set(
    completedTasks.slice(0, config.keepRecentCount).map((t) => t.id),
  );

  if (recentIds.has(task.id)) {
    return false;
  }

  // Validate complete lineage (all descendants completed, no active ancestors)
  return collectArchivableTasks(task.id, allTasks) !== null;
}

/**
 * Find all tasks that are eligible for auto-archiving.
 *
 * @param allTasks All tasks in the store
 * @param config Auto-archive configuration
 * @returns Array of tasks eligible for auto-archiving
 */
export function findAutoArchivableTasks(
  allTasks: Task[],
  config: AutoArchiveConfig = DEFAULT_AUTO_ARCHIVE_CONFIG,
): Task[] {
  // Only consider root-level completed tasks for auto-archiving
  // (children will be archived with their parents)
  return allTasks.filter((task) => {
    // Skip tasks that have parents - they'll be archived with their parent
    if (task.parent_id !== null) {
      return false;
    }
    return canAutoArchive(task, allTasks, config);
  });
}
