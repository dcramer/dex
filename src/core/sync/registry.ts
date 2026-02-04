import type { Task, TaskStore } from "../../types.js";
import type { IntegrationId, SyncAllOptions } from "./interface.js";

/**
 * Result from a sync operation with integration-specific metadata.
 */
export interface SyncResult {
  taskId: string;
  metadata: unknown;
  created: boolean;
  skipped?: boolean;
  /** Results for subtasks (used by integrations like Shortcut that sync subtasks separately) */
  subtaskResults?: SyncResult[];
  /** Updates to apply to the local task (when remote is newer) */
  localUpdates?: Record<string, unknown>;
  /** True if local task was updated from remote (remote was newer) */
  pulledFromRemote?: boolean;
  /** Reason why a completed task's issue/story won't close (e.g., commit not pushed) */
  issueNotClosingReason?: string;
}

/**
 * A sync service that can be registered.
 */
export interface RegisterableSyncService {
  readonly id: IntegrationId;
  readonly displayName: string;
  syncTask(task: Task, store: TaskStore): Promise<SyncResult | null>;
  syncAll(store: TaskStore, options?: SyncAllOptions): Promise<SyncResult[]>;
  /**
   * Close the remote item for a task (e.g., when the task is deleted locally).
   * Optional - services that don't support this will be skipped.
   */
  closeRemote?(task: Task): Promise<void>;
}

/**
 * Registry for managing multiple sync services.
 * Allows registering and retrieving sync services by integration ID.
 */
export class SyncRegistry {
  private services: Map<IntegrationId, RegisterableSyncService> = new Map();

  /**
   * Register a sync service.
   * Replaces any existing service with the same ID.
   */
  register(service: RegisterableSyncService): void {
    this.services.set(service.id, service);
  }

  /**
   * Get a sync service by its integration ID.
   */
  get(id: IntegrationId): RegisterableSyncService | undefined {
    return this.services.get(id);
  }

  /**
   * Get all registered sync services.
   */
  getAll(): RegisterableSyncService[] {
    return Array.from(this.services.values());
  }

  /**
   * Check if any services are registered.
   */
  hasServices(): boolean {
    return this.services.size > 0;
  }
}
