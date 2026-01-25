import * as fs from "node:fs";
import * as path from "node:path";
import { Task, TaskStore, TaskStoreSchema, TaskSchema } from "../types.js";
import { DataCorruptionError, StorageError } from "../errors.js";
import { StorageEngine } from "./storage-engine.js";
import { getProjectKey } from "./project-key.js";
import { getDexHome, type StorageMode } from "./config.js";

function findGitRoot(startDir: string): string | null {
  let currentDir: string;
  try {
    currentDir = fs.realpathSync(startDir);
  } catch {
    // If path doesn't exist or is inaccessible, fall back to input
    currentDir = startDir;
  }

  while (currentDir !== path.dirname(currentDir)) {
    const gitPath = path.join(currentDir, ".git");
    try {
      // Check if .git exists (file for worktrees, directory for regular repos)
      fs.statSync(gitPath);
      return currentDir;
    } catch {
      // .git doesn't exist at this level, continue traversing
    }
    currentDir = path.dirname(currentDir);
  }
  return null;
}

function getDefaultStoragePath(mode: StorageMode = "in-repo"): string {
  if (mode === "centralized") {
    const projectKey = getProjectKey();
    return path.join(getDexHome(), "projects", projectKey);
  }

  // in-repo mode: use git root or dex home directory
  const gitRoot = findGitRoot(process.cwd());
  if (gitRoot) {
    return path.join(gitRoot, ".dex");
  }
  return path.join(getDexHome(), "local");
}

function getStoragePath(mode?: StorageMode): string {
  return process.env.DEX_STORAGE_PATH || getDefaultStoragePath(mode);
}

export interface FileStorageOptions {
  /** Explicit storage path (overrides mode) */
  path?: string;
  /** Storage mode: "in-repo" (default) or "centralized" */
  mode?: StorageMode;
}

export class FileStorage implements StorageEngine {
  private storagePath: string;

  constructor(options?: string | FileStorageOptions) {
    if (typeof options === "string") {
      // Backward compatibility: accept path as string
      this.storagePath = options;
    } else if (options?.path) {
      this.storagePath = options.path;
    } else {
      this.storagePath = getStoragePath(options?.mode);
    }
  }

  private get tasksDir(): string {
    return path.join(this.storagePath, "tasks");
  }

  private get oldFormatPath(): string {
    return path.join(this.storagePath, "tasks.json");
  }

  private ensureDirectory(): void {
    fs.mkdirSync(this.tasksDir, { recursive: true });
  }

  private migrateFromOldFormat(): void {
    const oldPath = this.oldFormatPath;
    if (!fs.existsSync(oldPath)) {
      return;
    }

    let content: string;
    try {
      content = fs.readFileSync(oldPath, "utf-8");
    } catch {
      return;
    }

    if (!content.trim()) {
      fs.unlinkSync(oldPath);
      return;
    }

    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch {
      // Can't migrate corrupted file, leave it
      return;
    }

    const result = TaskStoreSchema.safeParse(data);
    if (!result.success) {
      // Can't migrate invalid schema, leave it
      return;
    }

    // Write tasks to new format
    this.write(result.data);

    // Remove old file after successful migration
    fs.unlinkSync(oldPath);
  }

  read(): TaskStore {
    // Check for old format and migrate if needed
    this.migrateFromOldFormat();

    if (!fs.existsSync(this.tasksDir)) {
      return { tasks: [] };
    }

    let files: string[];
    try {
      files = fs.readdirSync(this.tasksDir).filter((f) => f.endsWith(".json"));
    } catch {
      return { tasks: [] };
    }

    const tasks: Task[] = [];
    for (const file of files) {
      const filePath = path.join(this.tasksDir, file);
      let content: string;
      try {
        content = fs.readFileSync(filePath, "utf-8");
      } catch {
        continue;
      }

      if (!content.trim()) {
        continue;
      }

      let data: unknown;
      try {
        data = JSON.parse(content);
      } catch (parseErr) {
        const errorMessage =
          parseErr instanceof Error ? parseErr.message : String(parseErr);
        throw new DataCorruptionError(
          filePath,
          parseErr instanceof Error ? parseErr : undefined,
          `Invalid JSON: ${errorMessage}`
        );
      }

      const result = TaskSchema.safeParse(data);
      if (!result.success) {
        throw new DataCorruptionError(
          filePath,
          undefined,
          `Invalid schema: ${result.error.message}`
        );
      }

      tasks.push(result.data);
    }

    return { tasks };
  }

  write(store: TaskStore): void {
    this.ensureDirectory();

    // Get existing task IDs from files
    const existingFiles = fs.existsSync(this.tasksDir)
      ? fs.readdirSync(this.tasksDir).filter((f) => f.endsWith(".json"))
      : [];
    const existingIds = new Set(existingFiles.map((f) => f.replace(".json", "")));

    // Write/update tasks
    const currentIds = new Set<string>();
    for (const task of store.tasks) {
      currentIds.add(task.id);
      const taskPath = path.join(this.tasksDir, `${task.id}.json`);
      try {
        fs.writeFileSync(taskPath, JSON.stringify(task, null, 2), "utf-8");
      } catch (err) {
        const originalError = err instanceof Error ? err : undefined;
        throw new StorageError(
          `Failed to write task "${task.id}" to "${taskPath}"`,
          originalError,
          "Check file permissions and available disk space"
        );
      }
    }

    // Delete removed tasks
    for (const id of existingIds) {
      if (!currentIds.has(id)) {
        try {
          fs.unlinkSync(path.join(this.tasksDir, `${id}.json`));
        } catch {
          // Ignore deletion errors - file may have already been removed
        }
      }
    }
  }

  getIdentifier(): string {
    return this.storagePath;
  }

  /**
   * @deprecated Use getIdentifier() instead. Kept for backward compatibility.
   */
  getPath(): string {
    return this.getIdentifier();
  }

  /**
   * Async read implementation (wraps synchronous read)
   */
  async readAsync(): Promise<TaskStore> {
    return this.read();
  }

  /**
   * Async write implementation (wraps synchronous write)
   */
  async writeAsync(store: TaskStore): Promise<void> {
    this.write(store);
  }

  /**
   * File storage supports synchronous operations
   */
  isSync(): boolean {
    return true;
  }
}

// Backward compatibility alias
export const TaskStorage = FileStorage;
