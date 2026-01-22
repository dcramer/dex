import { TaskStore } from "../types.js";

/**
 * Storage engine interface for persisting tasks.
 *
 * Implementations can store tasks in various backends:
 * - File system (FileStorage)
 * - GitHub Issues (GitHubIssuesStorage)
 * - GitHub Projects v2 (GitHubProjectsStorage)
 */
export interface StorageEngine {
  /**
   * Read all tasks from storage.
   * @returns TaskStore containing all tasks
   * @throws {StorageError} If storage cannot be read
   * @throws {DataCorruptionError} If stored data is corrupted
   */
  read(): TaskStore;

  /**
   * Write tasks to storage.
   * @param store The task store to persist
   * @throws {StorageError} If storage cannot be written
   */
  write(store: TaskStore): void;

  /**
   * Get a human-readable identifier for this storage backend.
   * For file storage: returns the directory path
   * For GitHub storage: returns "owner/repo" or "owner/project#N"
   * @returns Storage identifier string
   */
  getIdentifier(): string;
}
