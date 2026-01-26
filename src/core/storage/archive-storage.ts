import * as fs from "node:fs";
import * as path from "node:path";
import { ArchivedTask, ArchivedTaskSchema, ArchiveStore } from "../../types.js";
import { DataCorruptionError, StorageError } from "../../errors.js";
import { type StorageMode } from "../config.js";
import { getStoragePath } from "./paths.js";

export interface ArchiveStorageOptions {
  /** Explicit storage path (overrides mode) */
  path?: string;
  /** Storage mode: "in-repo" (default) or "centralized" */
  mode?: StorageMode;
}

/**
 * Storage for archived (completed) tasks in JSONL format.
 * Archived tasks are compacted versions that drop context and relationship fields.
 */
export class ArchiveStorage {
  private storagePath: string;

  constructor(options?: string | ArchiveStorageOptions) {
    this.storagePath =
      typeof options === "string"
        ? options
        : (options?.path ?? getStoragePath(options?.mode));
  }

  private get archiveFile(): string {
    return path.join(this.storagePath, "archive.jsonl");
  }

  private ensureDirectory(): void {
    fs.mkdirSync(this.storagePath, { recursive: true });
  }

  private sortTasksById(tasks: ArchivedTask[]): void {
    tasks.sort((a, b) => a.id.localeCompare(b.id));
  }

  private formatAsJsonl(tasks: ArchivedTask[]): string {
    if (tasks.length === 0) return "";
    return tasks.map((task) => JSON.stringify(task)).join("\n") + "\n";
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

  /**
   * Read all archived tasks from archive.jsonl
   */
  readArchive(): ArchiveStore {
    if (!fs.existsSync(this.archiveFile)) {
      return { tasks: [] };
    }

    let content: string;
    try {
      content = fs.readFileSync(this.archiveFile, "utf-8");
    } catch (err) {
      const originalError = err instanceof Error ? err : undefined;
      throw new StorageError(
        `Failed to read archive from "${this.archiveFile}"`,
        originalError,
        "Check file permissions",
      );
    }

    if (!content.trim()) {
      return { tasks: [] };
    }

    const tasks: ArchivedTask[] = [];
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
          this.archiveFile,
          parseErr instanceof Error ? parseErr : undefined,
          `Invalid JSON on line ${i + 1}: ${errorMessage}`,
        );
      }

      const result = ArchivedTaskSchema.safeParse(data);
      if (!result.success) {
        throw new DataCorruptionError(
          this.archiveFile,
          undefined,
          `Invalid schema on line ${i + 1}: ${result.error.message}`,
        );
      }

      tasks.push(result.data);
    }

    this.sortTasksById(tasks);
    return { tasks };
  }

  /**
   * Write the entire archive store (full replacement)
   */
  writeArchive(store: ArchiveStore): void {
    this.ensureDirectory();

    const sortedTasks = [...store.tasks];
    this.sortTasksById(sortedTasks);

    const tempFile = `${this.archiveFile}.tmp`;
    try {
      fs.writeFileSync(tempFile, this.formatAsJsonl(sortedTasks), "utf-8");
      fs.renameSync(tempFile, this.archiveFile);
    } catch (err) {
      this.cleanupTempFile(tempFile);
      const originalError = err instanceof Error ? err : undefined;
      throw new StorageError(
        `Failed to write archive to "${this.archiveFile}"`,
        originalError,
        "Check file permissions and available disk space",
      );
    }
  }

  /**
   * Append tasks to the archive (efficient for archiving operations)
   */
  appendArchive(tasks: ArchivedTask[]): void {
    if (tasks.length === 0) return;

    this.ensureDirectory();

    // Read existing, merge, and write to maintain sorted order
    const existing = this.readArchive();
    const existingIds = new Set(existing.tasks.map((t) => t.id));

    // Filter out duplicates (tasks already archived)
    const newTasks = tasks.filter((t) => !existingIds.has(t.id));
    if (newTasks.length === 0) return;

    const merged = [...existing.tasks, ...newTasks];
    this.writeArchive({ tasks: merged });
  }

  /**
   * Search archived tasks by name or result
   */
  searchArchive(query: string): ArchivedTask[] {
    const store = this.readArchive();
    const lowerQuery = query.toLowerCase();

    return store.tasks.filter((task) => {
      if (task.name.toLowerCase().includes(lowerQuery)) return true;
      if (task.result?.toLowerCase().includes(lowerQuery)) return true;
      // Also search in archived children
      return task.archived_children.some(
        (child) =>
          child.name.toLowerCase().includes(lowerQuery) ||
          child.result?.toLowerCase().includes(lowerQuery),
      );
    });
  }

  /**
   * Get a specific archived task by ID
   */
  getArchived(id: string): ArchivedTask | undefined {
    const store = this.readArchive();
    return store.tasks.find((t) => t.id === id);
  }

  /**
   * Remove tasks from archive by ID
   */
  removeArchived(ids: string[]): void {
    if (ids.length === 0) return;

    const store = this.readArchive();
    const idsToRemove = new Set(ids);
    const filtered = store.tasks.filter((t) => !idsToRemove.has(t.id));

    if (filtered.length !== store.tasks.length) {
      this.writeArchive({ tasks: filtered });
    }
  }

  /**
   * Get storage identifier
   */
  getIdentifier(): string {
    return this.storagePath;
  }
}
