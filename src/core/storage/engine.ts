import { TaskStore } from "../../types.js";

/**
 * Storage engine interface for persisting tasks.
 *
 * Implementations can store tasks in various backends:
 * - File system (FileStorage) - synchronous
 * - GitHub Issues (GitHubIssuesStorage) - asynchronous
 * - GitHub Projects v2 (GitHubProjectsStorage) - asynchronous
 *
 * Note: Some storage backends (GitHub) require async operations.
 * For these, use readAsync() and writeAsync() methods.
 */
export interface StorageEngine {
  /**
   * Read all tasks from storage (synchronous).
   * For async backends, this will throw an error.
   * @returns TaskStore containing all tasks
   * @throws {StorageError} If storage cannot be read or is async-only
   * @throws {DataCorruptionError} If stored data is corrupted
   */
  read(): TaskStore;

  /**
   * Write tasks to storage (synchronous).
   * For async backends, this will throw an error.
   * @param store The task store to persist
   * @throws {StorageError} If storage cannot be written or is async-only
   */
  write(store: TaskStore): void;

  /**
   * Read all tasks from storage (asynchronous).
   * All storage backends must implement this.
   * @returns Promise resolving to TaskStore containing all tasks
   * @throws {StorageError} If storage cannot be read
   * @throws {DataCorruptionError} If stored data is corrupted
   */
  readAsync(): Promise<TaskStore>;

  /**
   * Write tasks to storage (asynchronous).
   * All storage backends must implement this.
   * @param store The task store to persist
   * @returns Promise that resolves when write is complete
   * @throws {StorageError} If storage cannot be written
   */
  writeAsync(store: TaskStore): Promise<void>;

  /**
   * Get a human-readable identifier for this storage backend.
   * For file storage: returns the directory path
   * For GitHub storage: returns "owner/repo" or "owner/project#N"
   * @returns Storage identifier string
   */
  getIdentifier(): string;

  /**
   * Check if this storage backend supports synchronous operations.
   * @returns true if read() and write() are supported, false if async-only
   */
  isSync(): boolean;
}
