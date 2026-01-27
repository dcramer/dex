import * as fs from "node:fs";
import * as path from "node:path";
import { ArchivedTask, Task, TaskStore } from "../types.js";
import { ArchiveConfig } from "./config.js";
import {
  findAutoArchivableTasks,
  collectArchivableTasks,
  compactTask,
  AutoArchiveConfig,
} from "./archive-compactor.js";
import { ArchiveStorage } from "./storage/archive-storage.js";
import { cleanupTaskReferences } from "./task-relationships.js";
import { isCommitOnRemote } from "./git-utils.js";

/**
 * Default auto-archive configuration.
 * Auto-archive is OFF by default (opt-in).
 */
export const DEFAULT_ARCHIVE_CONFIG: Required<ArchiveConfig> = {
  auto: false,
  age_days: 90,
  keep_recent: 50,
};

/**
 * Result of an auto-archive operation.
 */
export interface AutoArchiveResult {
  /** Number of tasks archived */
  archivedCount: number;
  /** IDs of archived tasks */
  archivedIds: string[];
}

/**
 * Convert ArchiveConfig to AutoArchiveConfig format used by archive-compactor.
 */
function toAutoArchiveConfig(config: ArchiveConfig): AutoArchiveConfig {
  return {
    minAgeDays: config.age_days ?? DEFAULT_ARCHIVE_CONFIG.age_days,
    keepRecentCount: config.keep_recent ?? DEFAULT_ARCHIVE_CONFIG.keep_recent,
  };
}

/**
 * Check if a task's commit has been pushed to origin.
 * Only tasks with pushed commits (or no commit SHA) can be auto-archived.
 */
function isTaskPushed(task: Task): boolean {
  const sha = task.metadata?.commit?.sha;
  // No commit SHA means we can't verify - allow archiving
  return !sha || isCommitOnRemote(sha);
}

/**
 * Log an auto-archive event to the archive log file.
 */
function logArchiveEvent(
  storagePath: string,
  taskIds: string[],
  taskNames: string[],
): void {
  const logPath = path.join(storagePath, "archive.log");
  const timestamp = new Date().toISOString();

  const entries = taskIds.map((id, i) => {
    const name = taskNames[i] ?? "Unknown";
    return `${timestamp} AUTO-ARCHIVED ${id}: ${name}`;
  });

  const logContent = entries.join("\n") + "\n";

  try {
    fs.appendFileSync(logPath, logContent, "utf-8");
  } catch {
    // Ignore logging errors - don't fail the main operation
  }
}

/**
 * Perform auto-archiving on the task store.
 *
 * This function:
 * 1. Finds tasks eligible for auto-archiving (based on age and count criteria)
 * 2. Archives them to archive.jsonl
 * 3. Removes them from the active task store
 * 4. Logs the operation to archive.log
 *
 * @param store The task store (will be mutated to remove archived tasks)
 * @param storagePath Path to the storage directory
 * @param config Archive configuration
 * @returns Result with count and IDs of archived tasks
 */
export function performAutoArchive(
  store: TaskStore,
  storagePath: string,
  config?: ArchiveConfig,
): AutoArchiveResult {
  const effectiveConfig = {
    ...DEFAULT_ARCHIVE_CONFIG,
    ...config,
  };

  // Skip if auto-archive is disabled
  if (!effectiveConfig.auto) {
    return { archivedCount: 0, archivedIds: [] };
  }

  const autoArchiveConfig = toAutoArchiveConfig(effectiveConfig);

  // Find eligible tasks (root-level only)
  const eligibleTasks = findAutoArchivableTasks(store.tasks, autoArchiveConfig);

  // Filter to only tasks whose commits have been pushed to origin
  // This ensures we don't archive work that hasn't been published yet
  const pushedTasks = eligibleTasks.filter(isTaskPushed);

  if (pushedTasks.length === 0) {
    return { archivedCount: 0, archivedIds: [] };
  }

  const archivedIds: string[] = [];
  const archivedNames: string[] = [];
  const allIdsToRemove = new Set<string>();
  const archiveStorage = new ArchiveStorage({ path: storagePath });
  const tasksToArchive: ArchivedTask[] = [];

  // Process each eligible task
  for (const rootTask of pushedTasks) {
    const collected = collectArchivableTasks(rootTask.id, store.tasks);
    if (!collected) continue;

    const { root, descendants } = collected;
    const allInLineage = [root, ...descendants];

    // Compact all tasks in lineage with their direct children
    for (const task of allInLineage) {
      const children = allInLineage.filter((t) => t.parent_id === task.id);
      tasksToArchive.push(compactTask(task, children));
      allIdsToRemove.add(task.id);
    }

    archivedIds.push(root.id);
    archivedNames.push(root.name);
  }

  if (tasksToArchive.length === 0) {
    return { archivedCount: 0, archivedIds: [] };
  }

  // Append to archive
  archiveStorage.appendArchive(tasksToArchive);

  // Remove from active tasks and clean up references
  const remainingTasks = store.tasks.filter((t) => !allIdsToRemove.has(t.id));

  // Clean up blocking references in remaining tasks
  for (const archivedId of allIdsToRemove) {
    cleanupTaskReferences({ tasks: remainingTasks }, archivedId);
  }

  // Update the store in place
  store.tasks = remainingTasks;

  // Log the archive operation
  logArchiveEvent(storagePath, archivedIds, archivedNames);

  return {
    archivedCount: archivedIds.length,
    archivedIds,
  };
}
