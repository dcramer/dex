# Sync Integration Architecture

This document describes how to implement a sync integration for dex. Sync integrations enable local-first sync of tasks with external issue trackers (GitHub Issues, Shortcut Stories, etc.), pushing local state and pulling remote state when newer.

## Core Concepts

- **Local-first sync**: The local `.dex/tasks.jsonl` file is the source of truth, but remote state is pulled when newer (timestamp-based reconciliation).
- **Idempotent operations**: Running sync twice should not duplicate remote items.
- **Progress reporting**: Bulk operations report progress via callbacks.

## Required Interface

Every sync service must implement `RegisterableSyncService` from `./registry.ts`:

```typescript
interface RegisterableSyncService {
  readonly id: IntegrationId;
  readonly displayName: string;
  syncTask(task: Task, store: TaskStore): Promise<SyncResult | null>;
  syncAll(store: TaskStore, options?: SyncAllOptions): Promise<SyncResult[]>;
  closeRemote?(task: Task): Promise<void>;
}
```

For type-safe metadata, implement `SyncService<T>` from `./interface.ts` instead. This adds `getRemoteId()` and `getRemoteUrl()` helper methods and provides generic typing for `SyncResult<T>`.

## Method Contracts

### `syncTask(task, store)`

Sync a single task to the remote system.

**Behavior:**

- For subtasks: sync the root parent instead (or handle per integration)
- Return `null` if sync is not applicable (e.g., subtask with no parent)
- Return `SyncResult` with metadata to store on the task

**SyncResult fields:**

- `taskId` - Local task ID
- `metadata` - Integration-specific data to save on the task
- `created` - True if a new remote item was created
- `skipped` - True if no changes were needed (optional)
- `subtaskResults` - Results for subtasks synced separately (optional)
- `localUpdates` - Updates to apply locally when remote is newer (optional)
- `pulledFromRemote` - True if local was updated from remote (optional)
- `needsCreation` - True if a subtask exists remotely but not locally (optional)
- `createData` - Full task data for creation when `needsCreation` is true (optional)

### `syncAll(store, options)`

Sync all tasks to the remote system.

**Behavior:**

- Filter to parent tasks only (handle subtasks within each parent)
- Call `onProgress` callback for each task with phase: `"checking"`, `"creating"`, `"updating"`, or `"skipped"`
- Use `skipUnchanged` option (default: true) to skip tasks that haven't changed
- Fetch all remote items once at start for efficient change detection
- Continue syncing even if individual tasks fail

**Options:** `onProgress` callback for UI updates, `skipUnchanged` to skip unchanged tasks (default: true).

### `closeRemote(task)` (optional)

Close or complete the remote item when a task is deleted locally.

**Behavior:**

- No-op if task has no remote metadata
- Move to "closed"/"done" state in the remote system
- Used by `dex delete` to clean up remote tracking

### `getRemoteId(task)` and `getRemoteUrl(task)`

Extract remote identifiers from task metadata.

**Behavior:**

- Return `null` if task hasn't been synced
- Support legacy metadata formats if applicable

## Metadata Storage

Integration metadata is stored on `task.metadata.<integration>`:

```typescript
// GitHub
task.metadata.github = {
  issueNumber: 42,
  issueUrl: "https://github.com/owner/repo/issues/42",
  repo: "owner/repo",
  state: "open" | "closed",
};

// Shortcut
task.metadata.shortcut = {
  storyId: 12345,
  storyUrl: "https://app.shortcut.com/workspace/story/12345",
  workspace: "workspace",
  state: "unstarted" | "started" | "done",
};
```

Add your metadata schema to `src/types.ts`:

```typescript
export const MyIntegrationMetadataSchema = z.object({
  remoteId: z.number().int().positive(),
  remoteUrl: z.string().url(),
  // ... integration-specific fields
});

// Add to TaskMetadataSchema
export const TaskMetadataSchema = z.object({
  github: GithubMetadataSchema.optional(),
  shortcut: ShortcutMetadataSchema.optional(),
  myintegration: MyIntegrationMetadataSchema.optional(), // Add here
  // ...
});
```

## Subtask Handling

Integrations can handle subtasks differently:

| Integration | Push Strategy                                  | Import/Pull Strategy                        |
| ----------- | ---------------------------------------------- | ------------------------------------------- |
| GitHub      | Embedded in parent issue body as markdown      | Parsed from body, created as local subtasks |
| Shortcut    | Created as separate linked stories (Sub-tasks) | Imported as linked subtasks                 |

Choose the strategy that best fits the remote system's capabilities.

## Completion Behavior

| Integration | When Remote Items Close                                           |
| ----------- | ----------------------------------------------------------------- |
| GitHub      | When task is completed AND a git push occurs (via post-push hook) |
| Shortcut    | Immediately when task is marked completed                         |

GitHub uses a git hook to defer closing issues until code is actually pushed to the remote.

## Adding a New Integration

### 1. Create the integration directory

```
src/core/{name}/
├── sync.ts          # SyncService implementation
├── sync-factory.ts  # Factory functions for creating the service
├── token.ts         # Token retrieval from environment
├── index.ts         # Public exports
└── ...              # API client, markdown rendering, etc. as needed
```

### 2. Add the integration ID

In `src/core/sync/interface.ts`, add your integration to `IntegrationId` (which already includes placeholders for `gitlab`, `linear`, `jira`, and `bitbucket`).

### 3. Define metadata schema

In `src/types.ts`, add your metadata schema and include it in `TaskMetadataSchema`.

### 4. Add config types

In `src/core/config.ts`:

```typescript
export interface MyIntegrationSyncConfig extends IntegrationSyncConfig {
  token_env?: string;
  // ... integration-specific config
}

export interface SyncConfig {
  github?: GitHubSyncConfig;
  shortcut?: ShortcutSyncConfig;
  myintegration?: MyIntegrationSyncConfig; // Add here
}
```

### 5. Implement the sync service

In `src/core/{name}/sync.ts`, implement `SyncService<T>` or `RegisterableSyncService`.

### 6. Create factory functions

In `src/core/{name}/sync-factory.ts`:

```typescript
// For auto-sync (returns null if disabled or misconfigured)
export async function createMyIntegrationSyncService(
  config: MyIntegrationSyncConfig | undefined,
): Promise<MyIntegrationSyncService | null>;

// For manual commands (throws descriptive errors)
export async function createMyIntegrationSyncServiceOrThrow(
  config?: MyIntegrationSyncConfig,
): Promise<MyIntegrationSyncService>;
```

Both factories should be async for consistency.

### 7. Register in bootstrap

In `src/bootstrap.ts`:

```typescript
import { createMyIntegrationSyncService } from "./core/myintegration/sync-factory.js";

export async function createSyncRegistry(...): Promise<SyncRegistryResult> {
  // ...
  const myIntegrationService = await createMyIntegrationSyncService(syncConfig?.myintegration);
  if (myIntegrationService) {
    registry.register(myIntegrationService);
  }
  // ...
}
```

### 8. Add CLI support

Update `src/cli/sync.ts` and `src/cli/import.ts` to support the new integration.

## Testing

See existing tests for patterns:

- `src/core/github-sync.test.ts` - GitHub sync tests with mocked API
- `src/core/shortcut/sync.test.ts` - Shortcut sync tests

Key test scenarios:

- Creating new remote items
- Updating existing items
- Skipping unchanged items
- Handling API errors gracefully
- Progress callback invocation
- Subtask handling (push: embedded in parent body)
- Subtask creation during bulk import (`--all`)
- Subtask creation during sync pull (remote newer than local)
