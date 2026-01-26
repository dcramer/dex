import * as fs from "node:fs";
import * as path from "node:path";
import { Task, TaskStore, TaskSchema } from "../../types.js";
import { DataCorruptionError, StorageError } from "../../errors.js";
import { StorageEngine } from "./engine.js";
import { getProjectKey } from "../project-key.js";
import { getDexHome, type StorageMode } from "../config.js";

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

export interface JsonlStorageOptions {
  /** Explicit storage path (overrides mode) */
  path?: string;
  /** Storage mode: "in-repo" (default) or "centralized" */
  mode?: StorageMode;
}

export class JsonlStorage implements StorageEngine {
  private storagePath: string;

  constructor(options?: string | JsonlStorageOptions) {
    this.storagePath =
      typeof options === "string"
        ? options
        : (options?.path ?? getStoragePath(options?.mode));
  }

  private get tasksFile(): string {
    return path.join(this.storagePath, "tasks.jsonl");
  }

  private get legacyTasksDir(): string {
    return path.join(this.storagePath, "tasks");
  }

  private ensureDirectory(): void {
    fs.mkdirSync(this.storagePath, { recursive: true });
  }

  private sortTasksById(tasks: Task[]): void {
    tasks.sort((a, b) => a.id.localeCompare(b.id));
  }

  private formatAsJsonl(tasks: Task[]): string {
    if (tasks.length === 0) return "";
    return tasks.map((task) => JSON.stringify(task)).join("\n") + "\n";
  }

  /**
   * Migrate from file-per-task format (tasks/*.json) to JSONL format.
   * Only runs if tasks.jsonl doesn't exist and tasks/ directory does.
   * Backs up the old tasks/ directory to tasks.bak.
   */
  private migrateFromFilePerTask(): void {
    // Skip if JSONL file already exists or legacy directory doesn't exist
    if (fs.existsSync(this.tasksFile) || !fs.existsSync(this.legacyTasksDir)) {
      return;
    }

    // Skip if legacy path is not a directory
    try {
      if (!fs.statSync(this.legacyTasksDir).isDirectory()) return;
    } catch {
      return;
    }

    // Read all tasks from file-per-task format
    const files = fs
      .readdirSync(this.legacyTasksDir)
      .filter((f) => f.endsWith(".json"));

    const tasks: Task[] = [];
    for (const file of files) {
      const filePath = path.join(this.legacyTasksDir, file);
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        if (!content.trim()) continue;

        const data = JSON.parse(content);
        const result = TaskSchema.safeParse(data);
        if (result.success) {
          tasks.push(result.data);
        }
      } catch {
        // Skip invalid files during migration
      }
    }

    // Write to JSONL format
    this.ensureDirectory();
    this.sortTasksById(tasks);
    fs.writeFileSync(this.tasksFile, this.formatAsJsonl(tasks), "utf-8");

    // Backup the old tasks directory (use timestamp if tasks.bak exists)
    const backupPath = fs.existsSync(path.join(this.storagePath, "tasks.bak"))
      ? path.join(this.storagePath, `tasks.bak.${Date.now()}`)
      : path.join(this.storagePath, "tasks.bak");
    fs.renameSync(this.legacyTasksDir, backupPath);
  }

  read(): TaskStore {
    // Check for and perform migration from file-per-task format
    this.migrateFromFilePerTask();

    if (!fs.existsSync(this.tasksFile)) {
      return { tasks: [] };
    }

    let content: string;
    try {
      content = fs.readFileSync(this.tasksFile, "utf-8");
    } catch (err) {
      const originalError = err instanceof Error ? err : undefined;
      throw new StorageError(
        `Failed to read tasks from "${this.tasksFile}"`,
        originalError,
        "Check file permissions",
      );
    }

    if (!content.trim()) {
      return { tasks: [] };
    }

    const tasks: Task[] = [];
    const lines = content.split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      let data: unknown;
      try {
        data = JSON.parse(line);
      } catch (parseErr) {
        const errorMessage =
          parseErr instanceof Error ? parseErr.message : String(parseErr);
        throw new DataCorruptionError(
          this.tasksFile,
          parseErr instanceof Error ? parseErr : undefined,
          `Invalid JSON on line ${i + 1}: ${errorMessage}`,
        );
      }

      const result = TaskSchema.safeParse(data);
      if (!result.success) {
        throw new DataCorruptionError(
          this.tasksFile,
          undefined,
          `Invalid schema on line ${i + 1}: ${result.error.message}`,
        );
      }

      tasks.push(result.data);
    }

    this.sortTasksById(tasks);
    return { tasks };
  }

  write(store: TaskStore): void {
    this.ensureDirectory();

    const sortedTasks = [...store.tasks];
    this.sortTasksById(sortedTasks);

    const tempFile = `${this.tasksFile}.tmp`;
    try {
      fs.writeFileSync(tempFile, this.formatAsJsonl(sortedTasks), "utf-8");
      fs.renameSync(tempFile, this.tasksFile);
    } catch (err) {
      this.cleanupTempFile(tempFile);
      const originalError = err instanceof Error ? err : undefined;
      throw new StorageError(
        `Failed to write tasks to "${this.tasksFile}"`,
        originalError,
        "Check file permissions and available disk space",
      );
    }
  }

  private cleanupTempFile(tempFile: string): void {
    try {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
    } catch {
      // Ignore cleanup errors
    }
  }

  getIdentifier(): string {
    return this.storagePath;
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
   * JSONL storage supports synchronous operations
   */
  isSync(): boolean {
    return true;
  }
}
