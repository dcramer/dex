import type { ShortcutMetadata, Task, TaskStore } from "../../types.js";
import { ShortcutApi } from "./api.js";
import type { Workflow, WorkflowState } from "@shortcut/client";
import { renderStoryDescription, parseTaskMetadata } from "./story-markdown.js";
import type { IntegrationId } from "../sync/index.js";

/**
 * Result of syncing a task to Shortcut.
 * Contains the shortcut metadata that should be saved to the task.
 */
export interface SyncResult {
  taskId: string;
  shortcut: ShortcutMetadata;
  created: boolean;
  /** True if task was skipped because nothing changed */
  skipped?: boolean;
  /** Results for subtasks (only present on parent task results) */
  subtaskResults?: SyncResult[];
}

/**
 * Progress callback for sync operations.
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
 * Cached story data for efficient sync operations.
 */
export interface CachedStory {
  id: number;
  name: string;
  description: string;
  completed: boolean;
  labels: string[];
}

export interface ShortcutSyncServiceOptions {
  /** Shortcut API token */
  token: string;
  /** Shortcut workspace slug */
  workspace: string;
  /** Team ID or mention name for story creation */
  team: string;
  /** Workflow ID to use (uses team default if not set) */
  workflow?: number;
  /** Label name for dex stories (default: "dex") */
  label?: string;
}

export interface SyncAllOptions {
  /** Callback for progress updates */
  onProgress?: (progress: SyncProgress) => void;
  /** Whether to skip unchanged tasks (default: true) */
  skipUnchanged?: boolean;
}

/**
 * Shortcut Sync Service
 *
 * Provides one-way sync of tasks to Shortcut Stories.
 * File storage remains the source of truth.
 *
 * Behavior:
 * - Top-level tasks (no parent_id) -> Create/update Shortcut Story
 * - Subtasks -> Create as Shortcut Sub-tasks linked to parent story
 * - Blockers -> Synced as "blocks" story links
 * - Completed tasks -> Story moved to "done" workflow state
 * - Pending tasks -> Story in "unstarted" or "started" state
 */
export class ShortcutSyncService {
  readonly id: IntegrationId = "shortcut";
  readonly displayName = "Shortcut";

  private api: ShortcutApi;
  private workspace: string;
  private teamId: string;
  private workflowId: number | undefined;
  private label: string;

  // Cached workflow states for performance
  private workflowCache: Map<number, Workflow> = new Map();
  private resolvedTeamId: string | null = null;
  private resolvedWorkflowId: number | null = null;

  constructor(options: ShortcutSyncServiceOptions) {
    this.api = new ShortcutApi(options.token, options.workspace);
    this.workspace = options.workspace;
    this.teamId = options.team;
    this.workflowId = options.workflow;
    this.label = options.label || "dex";
  }

  /**
   * Get the workspace this service syncs to.
   */
  getWorkspace(): string {
    return this.workspace;
  }

  /**
   * Get the Shortcut story ID from a task.
   * Returns null if task hasn't been synced yet.
   */
  getRemoteId(task: Task): number | null {
    return getShortcutStoryId(task);
  }

  /**
   * Get the Shortcut story URL from a task.
   * Returns null if task hasn't been synced yet.
   */
  getRemoteUrl(task: Task): string | null {
    return task.metadata?.shortcut?.storyUrl ?? null;
  }

  /**
   * Resolve the team ID (handles mention names).
   */
  private async resolveTeamId(): Promise<string> {
    if (this.resolvedTeamId) {
      return this.resolvedTeamId;
    }

    // Check if it's already a UUID
    if (this.teamId.match(/^[0-9a-f-]{36}$/i)) {
      this.resolvedTeamId = this.teamId;
      return this.resolvedTeamId;
    }

    // Try to find by mention name
    const team = await this.api.findTeamByMentionName(this.teamId);
    if (!team) {
      throw new Error(`Team not found: ${this.teamId}`);
    }

    this.resolvedTeamId = team.id;
    return this.resolvedTeamId;
  }

  /**
   * Get or fetch workflow.
   */
  private async getWorkflow(workflowId: number): Promise<Workflow> {
    let workflow = this.workflowCache.get(workflowId);
    if (!workflow) {
      workflow = await this.api.getWorkflow(workflowId);
      this.workflowCache.set(workflowId, workflow);
    }
    return workflow;
  }

  /**
   * Get the workflow ID to use for new stories.
   */
  private async getWorkflowId(): Promise<number> {
    if (this.workflowId) {
      return this.workflowId;
    }

    // Return cached value if available
    if (this.resolvedWorkflowId !== null) {
      return this.resolvedWorkflowId;
    }

    // Get team's default workflow
    const teamId = await this.resolveTeamId();
    const team = await this.api.getTeam(teamId);
    if (team.workflow_ids.length === 0) {
      throw new Error(`Team ${this.teamId} has no workflows`);
    }
    this.resolvedWorkflowId = team.workflow_ids[0];
    return this.resolvedWorkflowId;
  }

  /**
   * Get the appropriate workflow state ID for a task.
   */
  private async getWorkflowStateId(
    task: Task,
    workflowId: number,
  ): Promise<number> {
    const workflow = await this.getWorkflow(workflowId);

    if (task.completed) {
      const doneState = workflow.states.find(
        (s: WorkflowState) => s.type === "done",
      );
      if (!doneState) {
        throw new Error(`No done state found in workflow ${workflowId}`);
      }
      return doneState.id;
    }

    // For non-completed tasks, use unstarted state
    const unstartedState = workflow.states.find(
      (s: WorkflowState) => s.type === "unstarted",
    );
    if (!unstartedState) {
      throw new Error(`No unstarted state found in workflow ${workflowId}`);
    }
    return unstartedState.id;
  }

  /**
   * Get the workflow state type from a state ID.
   */
  private async getWorkflowStateType(
    workflowId: number,
    stateId: number,
  ): Promise<"unstarted" | "started" | "done"> {
    const workflow = await this.getWorkflow(workflowId);
    const state = workflow.states.find((s: WorkflowState) => s.id === stateId);
    return (state?.type as "unstarted" | "started" | "done") || "unstarted";
  }

  /**
   * Sync a single task to Shortcut.
   * For subtasks, syncs the parent story instead.
   * Returns sync result with shortcut metadata.
   */
  async syncTask(task: Task, store: TaskStore): Promise<SyncResult | null> {
    // If this is a subtask, sync the parent instead
    if (task.parent_id) {
      const parent = store.tasks.find((t) => t.id === task.parent_id);
      if (parent) {
        return this.syncTask(parent, store);
      }
      return null;
    }

    return this.syncParentTask(task, store);
  }

  /**
   * Sync all tasks to Shortcut.
   * Returns array of sync results.
   */
  async syncAll(
    store: TaskStore,
    options: SyncAllOptions = {},
  ): Promise<SyncResult[]> {
    const { onProgress, skipUnchanged = true } = options;
    const results: SyncResult[] = [];
    const parentTasks = store.tasks.filter((t) => !t.parent_id);
    const total = parentTasks.length;

    // Ensure the dex label exists
    await this.api.ensureLabel(this.label);

    // Fetch all stories once at start for efficient lookups
    const storyCache = await this.fetchAllDexStories();

    for (let i = 0; i < parentTasks.length; i++) {
      const parent = parentTasks[i];

      // Report checking phase
      onProgress?.({
        current: i + 1,
        total,
        task: parent,
        phase: "checking",
      });

      const result = await this.syncParentTask(parent, store, {
        skipUnchanged,
        onProgress,
        currentIndex: i + 1,
        total,
        storyCache,
      });
      if (result) {
        results.push(result);
      }
    }
    return results;
  }

  /**
   * Build a SyncResult for an existing story.
   */
  private buildSyncResult(
    taskId: string,
    storyId: number,
    storyUrl: string,
    created: boolean,
    state: "unstarted" | "started" | "done",
    skipped?: boolean,
  ): SyncResult {
    return {
      taskId,
      shortcut: {
        storyId,
        storyUrl,
        workspace: this.workspace,
        state,
      },
      created,
      skipped,
    };
  }

  /**
   * Sync a parent task (with all descendants) to Shortcut.
   * Returns sync result with shortcut metadata.
   */
  private async syncParentTask(
    parent: Task,
    store: TaskStore,
    options: {
      skipUnchanged?: boolean;
      onProgress?: (progress: SyncProgress) => void;
      currentIndex?: number;
      total?: number;
      storyCache?: Map<string, CachedStory>;
    } = {},
  ): Promise<SyncResult | null> {
    const {
      skipUnchanged = true,
      onProgress,
      currentIndex = 1,
      total = 1,
      storyCache,
    } = options;

    // Collect subtasks (immediate children only - they become Shortcut Sub-tasks)
    const subtasks = store.tasks.filter((t) => t.parent_id === parent.id);

    // Check for existing story: first metadata, then cache, then API fallback
    let storyId = getShortcutStoryId(parent);
    if (!storyId && storyCache) {
      const cached = storyCache.get(parent.id);
      if (cached) {
        storyId = cached.id;
      }
    }
    if (!storyId) {
      // Fallback for single-task sync (no cache)
      storyId = await this.findStoryByTaskId(parent.id);
    }

    const workflowId = await this.getWorkflowId();
    const expectedStateType = parent.completed ? "done" : "unstarted";

    if (storyId) {
      // Fast path: skip completed tasks that are already synced as done
      const storedState = parent.metadata?.shortcut?.state;
      if (
        skipUnchanged &&
        expectedStateType === "done" &&
        storedState === "done"
      ) {
        onProgress?.({
          current: currentIndex,
          total,
          task: parent,
          phase: "skipped",
        });
        const storyUrl = await this.api.buildStoryUrl(storyId);
        return this.buildSyncResult(
          parent.id,
          storyId,
          storyUrl,
          false,
          expectedStateType,
          true,
        );
      }

      // Check if we can skip this update by comparing with Shortcut
      if (skipUnchanged) {
        const expectedDescription = renderStoryDescription(parent);

        // Use cached data for change detection when available
        const cached = storyCache?.get(parent.id);
        const hasChanges = cached
          ? this.hasStoryChangedFromCache(
              cached,
              parent.name,
              expectedDescription,
              parent.completed,
            )
          : await this.hasStoryChanged(
              storyId,
              parent.name,
              expectedDescription,
              parent.completed,
            );

        if (!hasChanges) {
          onProgress?.({
            current: currentIndex,
            total,
            task: parent,
            phase: "skipped",
          });
          const storyUrl = await this.api.buildStoryUrl(storyId);
          return this.buildSyncResult(
            parent.id,
            storyId,
            storyUrl,
            false,
            expectedStateType,
            true,
          );
        }
      }

      onProgress?.({
        current: currentIndex,
        total,
        task: parent,
        phase: "updating",
      });

      await this.updateStory(parent, storyId, workflowId);

      // Sync subtasks as Shortcut Sub-tasks
      const subtaskResults = await this.syncSubtasks(
        subtasks,
        storyId,
        store,
        workflowId,
      );

      // Sync blocker relationships
      await this.syncBlockers(parent, storyId, store);

      const storyUrl = await this.api.buildStoryUrl(storyId);
      const result = this.buildSyncResult(
        parent.id,
        storyId,
        storyUrl,
        false,
        expectedStateType,
      );
      if (subtaskResults.length > 0) {
        result.subtaskResults = subtaskResults;
      }
      return result;
    } else {
      onProgress?.({
        current: currentIndex,
        total,
        task: parent,
        phase: "creating",
      });

      const shortcut = await this.createStory(parent, workflowId);

      // Sync subtasks as Shortcut Sub-tasks
      const subtaskResults = await this.syncSubtasks(
        subtasks,
        shortcut.storyId,
        store,
        workflowId,
      );

      // Sync blocker relationships
      await this.syncBlockers(parent, shortcut.storyId, store);

      const result: SyncResult = { taskId: parent.id, shortcut, created: true };
      if (subtaskResults.length > 0) {
        result.subtaskResults = subtaskResults;
      }
      return result;
    }
  }

  /**
   * Sync subtasks as Shortcut Sub-tasks.
   * Returns sync results for all subtasks (including nested) so metadata can be saved.
   */
  private async syncSubtasks(
    subtasks: Task[],
    parentStoryId: number,
    store: TaskStore,
    workflowId: number,
  ): Promise<SyncResult[]> {
    const teamId = await this.resolveTeamId();
    const results: SyncResult[] = [];

    for (const subtask of subtasks) {
      let subtaskStoryId = getShortcutStoryId(subtask);
      let created = false;

      if (subtaskStoryId) {
        // Update existing subtask
        await this.updateStory(subtask, subtaskStoryId, workflowId);
      } else {
        // Create new subtask with same team as parent
        const description = renderStoryDescription(subtask);
        const stateId = await this.getWorkflowStateId(subtask, workflowId);

        const story = await this.api.createSubtask(parentStoryId, {
          name: subtask.name,
          description,
          story_type: "chore",
          workflow_state_id: stateId,
          labels: [{ name: this.label }],
          group_id: teamId,
        });

        subtaskStoryId = story.id;
        created = true;
      }

      // Sync blocker relationships for this subtask
      await this.syncBlockers(subtask, subtaskStoryId, store);

      // Build result for this subtask
      const storyUrl = await this.api.buildStoryUrl(subtaskStoryId);
      const stateType = subtask.completed ? "done" : "unstarted";
      results.push({
        taskId: subtask.id,
        shortcut: {
          storyId: subtaskStoryId,
          storyUrl,
          workspace: this.workspace,
          state: stateType,
        },
        created,
      });

      // Recursively sync nested subtasks
      const nestedSubtasks = store.tasks.filter(
        (t) => t.parent_id === subtask.id,
      );
      if (nestedSubtasks.length > 0) {
        const nestedResults = await this.syncSubtasks(
          nestedSubtasks,
          subtaskStoryId,
          store,
          workflowId,
        );
        results.push(...nestedResults);
      }
    }

    return results;
  }

  /**
   * Sync blocker relationships as Shortcut story links.
   * Creates "blocks" links for tasks that this task is blocked by.
   */
  private async syncBlockers(
    task: Task,
    storyId: number,
    store: TaskStore,
  ): Promise<void> {
    if (!task.blockedBy || task.blockedBy.length === 0) {
      return;
    }

    // Get existing story links to avoid duplicates
    const existingLinks = await this.api.getStoryLinks(storyId);
    const existingBlockerIds = new Set(
      existingLinks
        .filter((link) => link.verb === "blocks" && link.object_id === storyId)
        .map((link) => link.subject_id),
    );

    for (const blockerId of task.blockedBy) {
      // Find the blocker task and its Shortcut story ID
      const blockerTask = store.tasks.find((t) => t.id === blockerId);
      if (!blockerTask) continue;

      const blockerStoryId = getShortcutStoryId(blockerTask);
      if (!blockerStoryId) continue;

      // Skip if link already exists
      if (existingBlockerIds.has(blockerStoryId)) continue;

      // Create "blocks" link: blockerStory blocks thisStory
      try {
        await this.api.createBlocksLink(blockerStoryId, storyId);
      } catch (error) {
        // Log warning but continue - blocker link failures shouldn't fail the sync
        const message =
          error instanceof Error ? error.message : "Unknown error";
        console.warn(
          `Warning: Failed to create blocker link from story ${blockerStoryId} to ${storyId}: ${message}`,
        );
      }
    }
  }

  /**
   * Check if a story has changed compared to what we would push.
   * Returns true if the story needs updating.
   */
  private async hasStoryChanged(
    storyId: number,
    expectedName: string,
    expectedDescription: string,
    shouldBeCompleted: boolean,
  ): Promise<boolean> {
    try {
      const story = await this.api.getStory(storyId);
      return this.storyNeedsUpdate(
        {
          name: story.name,
          description: story.description,
          completed: story.completed,
          labels: story.labels.map((l) => l.name),
        },
        expectedName,
        expectedDescription,
        shouldBeCompleted,
      );
    } catch {
      // If we can't fetch the story, assume it needs updating
      return true;
    }
  }

  /**
   * Check if a story has changed using cached data.
   */
  private hasStoryChangedFromCache(
    cached: CachedStory,
    expectedName: string,
    expectedDescription: string,
    shouldBeCompleted: boolean,
  ): boolean {
    return this.storyNeedsUpdate(
      {
        name: cached.name,
        description: cached.description,
        completed: cached.completed,
        labels: cached.labels,
      },
      expectedName,
      expectedDescription,
      shouldBeCompleted,
    );
  }

  /**
   * Compare story data against expected values.
   * Returns true if any field differs (story needs updating).
   */
  private storyNeedsUpdate(
    story: {
      name: string;
      description: string;
      completed: boolean;
      labels: string[];
    },
    expectedName: string,
    expectedDescription: string,
    shouldBeCompleted: boolean,
  ): boolean {
    if (story.name !== expectedName) return true;
    if (story.description.trim() !== expectedDescription.trim()) return true;
    if (story.completed !== shouldBeCompleted) return true;
    if (!story.labels.includes(this.label)) return true;
    return false;
  }

  /**
   * Create a new Shortcut story for a task.
   * Returns the shortcut metadata for the created story.
   */
  private async createStory(
    task: Task,
    workflowId: number,
  ): Promise<ShortcutMetadata> {
    const teamId = await this.resolveTeamId();
    const description = renderStoryDescription(task);
    const stateId = await this.getWorkflowStateId(task, workflowId);

    const story = await this.api.createStory({
      name: task.name,
      description,
      story_type: "feature",
      workflow_state_id: stateId,
      labels: [{ name: this.label }],
      group_id: teamId,
    });

    const storyUrl = await this.api.buildStoryUrl(story.id);
    const stateType = await this.getWorkflowStateType(workflowId, stateId);

    return {
      storyId: story.id,
      storyUrl,
      workspace: this.workspace,
      state: stateType,
    };
  }

  /**
   * Update an existing Shortcut story.
   */
  private async updateStory(
    task: Task,
    storyId: number,
    workflowId: number,
  ): Promise<void> {
    const description = renderStoryDescription(task);
    const stateId = await this.getWorkflowStateId(task, workflowId);

    await this.api.updateStory(storyId, {
      name: task.name,
      description,
      workflow_state_id: stateId,
      labels: [{ name: this.label }],
    });
  }

  /**
   * Look up a task by its local ID in Shortcut stories.
   * Uses search to find stories with the dex task ID in the description.
   */
  async findStoryByTaskId(taskId: string): Promise<number | null> {
    try {
      // Search for stories with the dex label that contain the task ID
      const response = await this.api.searchStories(
        `label:"${this.label}" description:"dex:task:id:${taskId}"`,
      );

      for (const story of response.data) {
        const description = story.description ?? "";
        const metadata = parseTaskMetadata(description);
        if (metadata?.id === taskId) {
          return story.id;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Fetch all dex-labeled stories.
   * Returns a Map keyed by task ID containing all data needed for change detection.
   */
  async fetchAllDexStories(): Promise<Map<string, CachedStory>> {
    const result = new Map<string, CachedStory>();

    try {
      const response = await this.api.searchStories(`label:"${this.label}"`);

      for (const story of response.data) {
        const description = story.description ?? "";
        const metadata = parseTaskMetadata(description);
        if (metadata?.id) {
          result.set(metadata.id, {
            id: story.id,
            name: story.name,
            description,
            completed: story.completed,
            labels: story.labels.map((l) => l.name),
          });
        }
      }
    } catch {
      // Return empty map on error
    }

    return result;
  }
}

/**
 * Extract Shortcut story ID from task metadata.
 * Returns null if not synced yet.
 */
export function getShortcutStoryId(task: Task): number | null {
  return task.metadata?.shortcut?.storyId ?? null;
}
