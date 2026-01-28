import type { Task, TaskStore } from "../../types.js";
import type { IntegrationId, SyncAllOptions } from "./interface.js";

/**
 * Result from a sync operation - loose type to support both
 * new interface format (metadata) and legacy GitHub format (github).
 */
export interface LegacySyncResult {
  taskId: string;
  created: boolean;
  skipped?: boolean;
  metadata?: unknown;
  github?: unknown;
}

/**
 * A sync service that can be registered.
 * This is a looser type than SyncService to allow legacy services
 * that don't fully implement the new interface yet.
 */
export interface RegisterableSyncService {
  readonly id: IntegrationId;
  readonly displayName: string;
  syncTask(task: Task, store: TaskStore): Promise<LegacySyncResult | null>;
  syncAll(
    store: TaskStore,
    options?: SyncAllOptions,
  ): Promise<LegacySyncResult[]>;
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
