import { TaskService } from "../core/task-service.js";
import type { StorageEngine } from "../core/storage/index.js";
import type { SyncRegistry } from "../core/sync/index.js";
import type { SyncConfig } from "../core/config.js";
import type { Task } from "../types.js";
import { extractErrorInfo } from "../errors.js";
import * as readline from "readline";
import { colors } from "./colors.js";

export interface CliOptions {
  storage: StorageEngine;
  syncRegistry?: SyncRegistry | null;
  syncConfig?: SyncConfig | null;
}

// ASCII art banner for CLI headers
export const ASCII_BANNER = ` ____  _____ __ __
|    \\|   __|  |  |
|  |  |   __|-   -|
|____/|_____|__|__|`;

export function createService(options: CliOptions): TaskService {
  return new TaskService({
    storage: options.storage,
    syncRegistry: options.syncRegistry,
    syncConfig: options.syncConfig,
  });
}

/**
 * Exit with error if task is not found, showing a hint to list all tasks.
 * Returns the task (narrowed to non-null) if found.
 */
export async function exitIfTaskNotFound(
  task: Task | null,
  id: string,
  service: TaskService,
): Promise<Task> {
  if (task) return task;
  console.error(
    `${colors.red}Error:${colors.reset} Task ${colors.bold}${id}${colors.reset} not found`,
  );
  const allTasks = await service.list({ all: true });
  if (allTasks.length > 0) {
    console.error(
      `${colors.dim}Hint:${colors.reset} Run ${colors.cyan}dex list --all${colors.reset} to see all tasks`,
    );
  }
  process.exit(1);
}

/**
 * Format an error for CLI output with proper coloring and suggestions.
 */
export function formatCliError(err: unknown): string {
  const { message, suggestion } = extractErrorInfo(err);
  let output = `${colors.red}Error:${colors.reset} ${message}`;
  if (suggestion) {
    output += `\n${colors.dim}Hint: ${suggestion}${colors.reset}`;
  }
  return output;
}

export function promptConfirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

/**
 * Find the root task (no parent) for a given task.
 * Traverses up the parent chain until reaching a task with no parent_id.
 */
export async function findRootTask(
  service: TaskService,
  task: Task,
): Promise<Task> {
  if (!task.parent_id) {
    return task;
  }
  const parent = await service.get(task.parent_id);
  if (!parent) {
    return task; // Orphaned subtask, treat as root
  }
  return findRootTask(service, parent);
}
