import type { Task, TaskStore } from "../../types.js";

/**
 * Supported integration identifiers.
 * Each integration has a unique ID used for configuration and metadata storage.
 */
export type IntegrationId =
  | "github"
  | "shortcut"
  | "gitlab"
  | "linear"
  | "jira"
  | "bitbucket";

/**
 * Base interface for integration-specific metadata.
 * Each integration extends this with its own required fields.
 */
export interface IntegrationMetadata {
  /** The unique identifier for the remote item (issue number, ticket ID, etc.) */
  remoteId: string | number;
  /** URL to the remote item */
  remoteUrl: string;
}

/**
 * Result of syncing a task to a remote integration.
 * Contains metadata that should be saved to the task.
 *
 * @template T The integration-specific metadata type
 */
export interface SyncResult<
  T extends IntegrationMetadata = IntegrationMetadata,
> {
  /** The local task ID that was synced */
  taskId: string;
  /** Integration-specific metadata to save */
  metadata: T;
  /** True if a new remote item was created */
  created: boolean;
  /** True if sync was skipped because nothing changed */
  skipped?: boolean;
  /** Updates to apply to the local task (when remote is newer) */
  localUpdates?: Partial<Task>;
  /** True if local task was updated from remote (remote was newer) */
  pulledFromRemote?: boolean;
}

/**
 * Progress callback for sync operations.
 * Used by syncAll to report progress to the caller.
 */
export interface SyncProgress {
  /** Current task index (1-based) */
  current: number;
  /** Total number of tasks */
  total: number;
  /** Task being processed */
  task: Task;
  /** Current phase of the sync */
  phase: "checking" | "creating" | "updating" | "skipped";
}

/**
 * Options for syncing all tasks to a remote integration.
 */
export interface SyncAllOptions {
  /** Callback for progress updates */
  onProgress?: (progress: SyncProgress) => void;
  /** Whether to skip unchanged tasks (default: true) */
  skipUnchanged?: boolean;
}

/**
 * Interface for sync services that push tasks to remote integrations.
 *
 * Implementations handle one-way sync from local tasks to a remote system
 * (GitHub Issues, Linear tickets, Jira issues, etc.). The local file storage
 * remains the source of truth.
 *
 * @template T The integration-specific metadata type stored on tasks
 */
export interface SyncService<
  T extends IntegrationMetadata = IntegrationMetadata,
> {
  /**
   * Unique identifier for this integration.
   * Used as the key in configuration and metadata storage.
   */
  readonly id: IntegrationId;

  /**
   * Human-readable name for display purposes.
   */
  readonly displayName: string;

  /**
   * Sync a single task to the remote integration.
   * For subtasks, implementations typically sync the parent issue instead.
   *
   * @param task The task to sync
   * @param store The full task store (needed for building hierarchies)
   * @returns Sync result with metadata, or null if sync was not applicable
   */
  syncTask(task: Task, store: TaskStore): Promise<SyncResult<T> | null>;

  /**
   * Sync all tasks to the remote integration.
   *
   * @param store The full task store
   * @param options Sync options including progress callback
   * @returns Array of sync results for each task
   */
  syncAll(store: TaskStore, options?: SyncAllOptions): Promise<SyncResult<T>[]>;

  /**
   * Get the remote ID for a task from its metadata.
   * Returns null if the task hasn't been synced to this integration.
   *
   * @param task The task to check
   * @returns The remote ID (issue number, ticket ID, etc.) or null
   */
  getRemoteId(task: Task): string | number | null;

  /**
   * Get the URL to the remote item for a task.
   * Returns null if the task hasn't been synced to this integration.
   *
   * @param task The task to check
   * @returns The URL to the remote item or null
   */
  getRemoteUrl(task: Task): string | null;
}
