import { Octokit } from "@octokit/rest";
import type { GithubMetadata, Task, TaskStore } from "../../types.js";
import type { GitHubRepo } from "./remote.js";
import type { HierarchicalTask } from "./issue-markdown.js";
import {
  collectDescendants,
  renderHierarchicalIssueBody,
  renderTaskMetadataComments,
} from "./issue-markdown.js";
import {
  parseRootTaskMetadata,
  parseHierarchicalIssueBody,
} from "./issue-parsing.js";
import { isCommitOnRemote } from "../git-utils.js";
import { isInProgress } from "../task-relationships.js";
import type { SyncResult } from "../sync/registry.js";

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
 * Cached issue data for efficient sync operations.
 * Contains all data needed for change detection without re-fetching.
 */
export interface CachedIssue {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  /** Only dex-prefixed labels (for change detection) */
  labels: string[];
  /** ALL labels including non-dex (for preserving during updates) */
  allLabels: string[];
}

export interface GitHubSyncServiceOptions {
  /** GitHub repository (inferred from git remote) */
  repo: GitHubRepo;
  /** GitHub personal access token */
  token: string;
  /** Label prefix for dex tasks (default: "dex") */
  labelPrefix?: string;
  /** Storage path for task files (default: ".dex") */
  storagePath?: string;
}

export interface SyncAllOptions {
  /** Callback for progress updates */
  onProgress?: (progress: SyncProgress) => void;
  /** Whether to skip unchanged tasks (default: true) */
  skipUnchanged?: boolean;
}

/**
 * GitHub Sync Service
 *
 * Provides one-way sync of tasks to GitHub Issues.
 * File storage remains the source of truth.
 *
 * Behavior:
 * - Top-level tasks (no parent_id) → Create/update GitHub Issue
 * - Subtasks → Embedded in parent issue body as markdown
 * - Completed tasks → Issue closed only when pushed to remote
 * - Pending tasks → Issue open
 *
 * Sync-on-push: GitHub issues are only closed when the task completion has been
 * pushed to origin/HEAD. This prevents issues from being prematurely closed
 * before code changes are pushed.
 */
export class GitHubSyncService {
  /** Integration ID for the SyncRegistry */
  readonly id = "github" as const;
  /** Human-readable name for display */
  readonly displayName = "GitHub";

  private octokit: Octokit;
  private owner: string;
  private repo: string;
  private labelPrefix: string;
  private storagePath: string;

  constructor(options: GitHubSyncServiceOptions) {
    this.octokit = new Octokit({ auth: options.token });
    this.owner = options.repo.owner;
    this.repo = options.repo.repo;
    this.labelPrefix = options.labelPrefix || "dex";
    this.storagePath = options.storagePath || ".dex";
  }

  /**
   * Get the repository this service syncs to.
   */
  getRepo(): GitHubRepo {
    return { owner: this.owner, repo: this.repo };
  }

  /**
   * Get the full repo string (owner/repo format).
   */
  getRepoString(): string {
    return `${this.owner}/${this.repo}`;
  }

  /**
   * Get the remote ID (issue number) for a task from its metadata.
   * Returns null if the task hasn't been synced to GitHub.
   * Supports both new format (metadata.github.issueNumber) and legacy format (metadata.github_issue_number).
   */
  getRemoteId(task: Task): number | null {
    return getGitHubIssueNumber(task);
  }

  /**
   * Get the URL to the GitHub issue for a task.
   * Returns null if the task hasn't been synced to GitHub.
   * Supports both new format (metadata.github.issueUrl) and legacy format.
   */
  getRemoteUrl(task: Task): string | null {
    // New format
    if (task.metadata?.github?.issueUrl) {
      return task.metadata.github.issueUrl;
    }
    // Legacy format - construct from issue number if we have it
    const issueNumber = this.getRemoteId(task);
    if (issueNumber) {
      return `https://github.com/${this.owner}/${this.repo}/issues/${issueNumber}`;
    }
    return null;
  }

  /**
   * Close the GitHub issue for a task (e.g., when the task is deleted locally).
   * If the task has no associated issue, this is a no-op.
   */
  async closeRemote(task: Task): Promise<void> {
    const issueNumber = this.getRemoteId(task);
    if (!issueNumber) return;

    await this.octokit.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      state: "closed",
    });
  }

  /**
   * Sync a single task to GitHub.
   * For subtasks, syncs the parent issue instead.
   * Returns sync result with github metadata.
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
   * Sync all tasks to GitHub.
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

    // Fetch all issues once at start for efficient lookups
    const issueCache = await this.fetchAllDexIssues();

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
        issueCache,
      });
      if (result) {
        results.push(result);
      }
    }
    return results;
  }

  /**
   * Build a SyncResult for an existing issue.
   */
  private buildSyncResult(
    taskId: string,
    issueNumber: number,
    created: boolean,
    state: "open" | "closed",
    options?: { skipped?: boolean; issueNotClosingReason?: string },
  ): SyncResult {
    return {
      taskId,
      metadata: {
        issueNumber,
        issueUrl: `https://github.com/${this.owner}/${this.repo}/issues/${issueNumber}`,
        repo: this.getRepoString(),
        state,
      },
      created,
      skipped: options?.skipped,
      issueNotClosingReason: options?.issueNotClosingReason,
    };
  }

  /**
   * Sync a parent task (with all descendants) to GitHub.
   * Returns sync result with github metadata.
   */
  private async syncParentTask(
    parent: Task,
    store: TaskStore,
    options: {
      skipUnchanged?: boolean;
      onProgress?: (progress: SyncProgress) => void;
      currentIndex?: number;
      total?: number;
      issueCache?: Map<string, CachedIssue>;
    } = {},
  ): Promise<SyncResult | null> {
    const {
      skipUnchanged = true,
      onProgress,
      currentIndex = 1,
      total = 1,
      issueCache,
    } = options;

    // Collect ALL descendants, not just immediate children
    // Apply push-check: subtasks only show as completed when their commit is pushed
    const descendants = collectDescendants(store.tasks, parent.id).map(
      (item) => ({
        ...item,
        task: { ...item.task, completed: this.shouldMarkCompleted(item.task) },
      }),
    );

    // Check for existing issue: first metadata, then cache, then API fallback
    let issueNumber = getGitHubIssueNumber(parent);
    if (!issueNumber && issueCache) {
      const cached = issueCache.get(parent.id);
      if (cached) {
        issueNumber = cached.number;
      }
    }
    if (!issueNumber) {
      // Fallback for single-task sync (no cache)
      issueNumber = await this.findIssueByTaskId(parent.id);
    }

    // Determine if task should be marked completed based on remote state
    const shouldClose = this.shouldMarkCompleted(parent, store);

    // Determine expected state for GitHub issue
    const expectedState = shouldClose ? "closed" : "open";

    // Get reason why issue won't close (if applicable)
    const issueNotClosingReason = this.getIssueNotClosingReason(parent, store);

    if (issueNumber) {
      // Fast path: skip completed tasks that are already synced as closed.
      // The stored state check ensures tasks completed locally (but synced while open) are re-synced.
      const storedState = parent.metadata?.github?.state;
      if (
        skipUnchanged &&
        expectedState === "closed" &&
        storedState === "closed"
      ) {
        onProgress?.({
          current: currentIndex,
          total,
          task: parent,
          phase: "skipped",
        });
        return this.buildSyncResult(
          parent.id,
          issueNumber,
          false,
          expectedState,
          {
            skipped: true,
          },
        );
      }

      // Get cached data for change detection and current state
      // IMPORTANT: When state is unknown (no cache), use undefined to preserve remote state
      // This prevents reopening closed issues when syncing a single task without cache
      const cached = issueCache?.get(parent.id);
      let currentState: "open" | "closed" | undefined = cached?.state;

      // Check if remote is newer than local (staleness detection)
      // If so, pull remote state to local instead of pushing
      if (cached?.body) {
        const remoteMetadata = parseRootTaskMetadata(cached.body);
        if (remoteMetadata?.updated_at && parent.updated_at) {
          const remoteUpdated = new Date(remoteMetadata.updated_at).getTime();
          const localUpdated = new Date(parent.updated_at).getTime();

          if (remoteUpdated > localUpdated) {
            // Remote is newer - pull remote state to local
            const localUpdates: Partial<Task> = {
              updated_at: remoteMetadata.updated_at,
            };

            // Pull completion state if remote is completed
            if (remoteMetadata.completed && !parent.completed) {
              localUpdates.completed = true;
              localUpdates.completed_at = remoteMetadata.completed_at;
              localUpdates.result = remoteMetadata.result;
              localUpdates.started_at = remoteMetadata.started_at;
            }

            // Pull commit metadata if present in remote
            // Only set the commit field - don't spread parent.metadata as it may contain
            // stale integration metadata that would overwrite fresh state in saveMetadata
            if (remoteMetadata.commit?.sha && !parent.metadata?.commit?.sha) {
              localUpdates.metadata = {
                commit: remoteMetadata.commit,
              };
            }

            // Pull subtask state from remote
            const subtaskResults = this.reconcileSubtasksFromRemote(
              cached.body,
              store,
            );

            onProgress?.({
              current: currentIndex,
              total,
              task: parent,
              phase: "skipped", // We're not pushing, we're pulling
            });

            return {
              taskId: parent.id,
              metadata: {
                issueNumber,
                issueUrl: `https://github.com/${this.owner}/${this.repo}/issues/${issueNumber}`,
                repo: this.getRepoString(),
                state: currentState,
              },
              created: false,
              skipped: true,
              localUpdates,
              pulledFromRemote: true,
              subtaskResults:
                subtaskResults.length > 0 ? subtaskResults : undefined,
            };
          }
        }
      }

      // Check if we can skip this update by comparing with GitHub
      let nonDexLabels: string[] = [];

      if (skipUnchanged) {
        const expectedBody = this.renderBody(parent, descendants);
        const expectedLabels = this.buildLabels(parent, shouldClose);

        let hasChanges: boolean;
        if (cached) {
          hasChanges = this.hasIssueChangedFromCache(
            cached,
            parent.name,
            expectedBody,
            expectedLabels,
            shouldClose,
          );
          nonDexLabels = cached.allLabels.filter(
            (l) => !l.startsWith(this.labelPrefix),
          );
        } else {
          // No cache - need to fetch from API to get current state
          const changeResult = await this.getIssueChangeResult(
            issueNumber,
            parent.name,
            expectedBody,
            expectedLabels,
            shouldClose,
          );
          hasChanges = changeResult.hasChanges;
          currentState = changeResult.currentState;
          nonDexLabels = changeResult.nonDexLabels;
        }

        if (!hasChanges) {
          onProgress?.({
            current: currentIndex,
            total,
            task: parent,
            phase: "skipped",
          });
          return this.buildSyncResult(
            parent.id,
            issueNumber,
            false,
            expectedState,
            {
              skipped: true,
              issueNotClosingReason,
            },
          );
        }
      } else if (!cached) {
        // skipUnchanged is false and no cache - still need to fetch current state
        // to avoid accidentally reopening closed issues, and fetch labels to preserve non-dex ones
        const issueData = await this.fetchIssueStateAndLabels(issueNumber);
        currentState = issueData.state;
        nonDexLabels = issueData.nonDexLabels;
      } else {
        // skipUnchanged is false but cache exists - extract non-dex labels from cache
        nonDexLabels = cached.allLabels.filter(
          (l) => !l.startsWith(this.labelPrefix),
        );
      }

      onProgress?.({
        current: currentIndex,
        total,
        task: parent,
        phase: "updating",
      });

      await this.updateIssue(
        parent,
        descendants,
        issueNumber,
        shouldClose,
        currentState,
        nonDexLabels,
      );
      return this.buildSyncResult(
        parent.id,
        issueNumber,
        false,
        expectedState,
        {
          issueNotClosingReason,
        },
      );
    } else {
      onProgress?.({
        current: currentIndex,
        total,
        task: parent,
        phase: "creating",
      });

      const metadata = await this.createIssue(parent, descendants, shouldClose);
      return {
        taskId: parent.id,
        metadata,
        created: true,
        issueNotClosingReason,
      };
    }
  }

  /**
   * Compare issue data against expected values.
   * Returns true if any field differs (issue needs updating).
   */
  private issueNeedsUpdate(
    issue: { title: string; body: string; state: string; labels: string[] },
    expectedTitle: string,
    expectedBody: string,
    expectedLabels: string[],
    shouldClose: boolean,
  ): boolean {
    if (issue.title !== expectedTitle) return true;
    if (issue.body.trim() !== expectedBody.trim()) return true;

    const expectedState = shouldClose ? "closed" : "open";
    if (issue.state !== expectedState) return true;

    const sortedLabels = [...issue.labels].sort();
    const sortedExpected = [...expectedLabels].sort();
    return JSON.stringify(sortedLabels) !== JSON.stringify(sortedExpected);
  }

  /**
   * Check if an issue has changed and get its current state.
   * Returns both change detection result and current state for safe updates.
   * When we can't fetch the issue, currentState is undefined to preserve remote state.
   */
  private async getIssueChangeResult(
    issueNumber: number,
    expectedTitle: string,
    expectedBody: string,
    expectedLabels: string[],
    shouldClose: boolean,
  ): Promise<{
    hasChanges: boolean;
    currentState: "open" | "closed" | undefined;
    nonDexLabels: string[];
  }> {
    try {
      const { data: issue } = await this.octokit.issues.get({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
      });

      const allLabels = (issue.labels || [])
        .map((l) => (typeof l === "string" ? l : l.name || ""))
        .filter((l) => l.length > 0);
      const dexLabels = allLabels.filter((l) => l.startsWith(this.labelPrefix));
      const nonDexLabels = allLabels.filter(
        (l) => !l.startsWith(this.labelPrefix),
      );

      const hasChanges = this.issueNeedsUpdate(
        {
          title: issue.title,
          body: issue.body || "",
          state: issue.state,
          labels: dexLabels,
        },
        expectedTitle,
        expectedBody,
        expectedLabels,
        shouldClose,
      );

      return {
        hasChanges,
        currentState: issue.state as "open" | "closed",
        nonDexLabels,
      };
    } catch {
      // If we can't fetch the issue, skip the update to avoid wiping non-dex labels.
      // Returning hasChanges: false prevents updateIssue() from being called with
      // empty nonDexLabels, which would destroy user-applied labels.
      return { hasChanges: false, currentState: undefined, nonDexLabels: [] };
    }
  }

  /**
   * Fetch the state and non-dex labels of an issue.
   * Throws if the issue can't be fetched, since callers need label data
   * to avoid wiping non-dex labels during updates.
   */
  private async fetchIssueStateAndLabels(issueNumber: number): Promise<{
    state: "open" | "closed";
    nonDexLabels: string[];
  }> {
    const { data: issue } = await this.octokit.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
    });
    const nonDexLabels = (issue.labels || [])
      .map((l) => (typeof l === "string" ? l : l.name || ""))
      .filter((l) => l.length > 0 && !l.startsWith(this.labelPrefix));
    return {
      state: issue.state as "open" | "closed",
      nonDexLabels,
    };
  }

  /**
   * Check if an issue has changed compared to what we would push using cached data.
   * Synchronous version of hasIssueChanged for use with issue cache.
   * Returns true if the issue needs updating.
   */
  private hasIssueChangedFromCache(
    cached: CachedIssue,
    expectedTitle: string,
    expectedBody: string,
    expectedLabels: string[],
    shouldClose: boolean,
  ): boolean {
    return this.issueNeedsUpdate(
      {
        title: cached.title,
        body: cached.body,
        state: cached.state,
        labels: cached.labels,
      },
      expectedTitle,
      expectedBody,
      expectedLabels,
      shouldClose,
    );
  }

  /**
   * Create a new GitHub issue for a task.
   * Returns the github metadata for the created issue.
   * Issue is created as closed if shouldClose is true.
   */
  private async createIssue(
    parent: Task,
    descendants: HierarchicalTask[],
    shouldClose: boolean,
  ): Promise<GithubMetadata> {
    const body = this.renderBody(parent, descendants);

    const { data: issue } = await this.octokit.issues.create({
      owner: this.owner,
      repo: this.repo,
      title: parent.name,
      body,
      labels: this.buildLabels(parent, shouldClose),
    });

    // Close issue if task completion has been pushed to remote
    if (shouldClose) {
      await this.octokit.issues.update({
        owner: this.owner,
        repo: this.repo,
        issue_number: issue.number,
        state: "closed",
      });
    }

    // Add result as comment if present and closed
    if (parent.result && shouldClose) {
      await this.octokit.issues.createComment({
        owner: this.owner,
        repo: this.repo,
        issue_number: issue.number,
        body: `## Result\n\n${parent.result}`,
      });
    }

    return {
      issueNumber: issue.number,
      issueUrl: issue.html_url,
      repo: this.getRepoString(),
      state: shouldClose ? "closed" : "open",
    };
  }

  /**
   * Update an existing GitHub issue.
   *
   * @param currentState - The current state of the issue on GitHub.
   *                       undefined means we don't know the current state.
   *                       Used to prevent reopening closed issues.
   */
  private async updateIssue(
    parent: Task,
    descendants: HierarchicalTask[],
    issueNumber: number,
    shouldClose: boolean,
    currentState: "open" | "closed" | undefined,
    nonDexLabels: string[],
  ): Promise<void> {
    const body = this.renderBody(parent, descendants);

    // Determine the state to set:
    // - If shouldClose is true, always close (even if already closed)
    // - If shouldClose is false and currently open, keep open
    // - If shouldClose is false and currently closed, DON'T reopen
    // - If shouldClose is false and state is unknown (undefined), don't set state
    //   (this preserves whatever the remote state is, preventing accidental reopening)
    let state: "open" | "closed" | undefined;
    if (shouldClose) {
      state = "closed";
    } else if (currentState === "open") {
      state = "open";
    }
    // If currentState is "closed" or undefined and shouldClose is false, don't set state
    // (keeps the issue in its current state, doesn't reopen it)

    await this.octokit.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      title: parent.name,
      body,
      labels: [...nonDexLabels, ...this.buildLabels(parent, shouldClose)],
      ...(state !== undefined && { state }),
    });
  }

  /**
   * Render the issue body with hierarchical task tree.
   * Includes root task metadata encoded in HTML comments for round-trip support.
   */
  private renderBody(task: Task, descendants: HierarchicalTask[]): string {
    const rootMeta = renderTaskMetadataComments(task, "task");
    const body = renderHierarchicalIssueBody(task.description, descendants);
    return `${rootMeta.join("\n")}\n${body}`;
  }

  /**
   * Build labels for a task.
   */
  private buildLabels(task: Task, shouldClose: boolean): string[] {
    let statusLabel: string;
    if (shouldClose) {
      statusLabel = `${this.labelPrefix}:completed`;
    } else if (isInProgress(task)) {
      statusLabel = `${this.labelPrefix}:in-progress`;
    } else {
      statusLabel = `${this.labelPrefix}:pending`;
    }

    return [
      this.labelPrefix,
      `${this.labelPrefix}:priority-${task.priority}`,
      statusLabel,
    ];
  }

  /**
   * Determine if a task should be marked as completed in GitHub.
   *
   * - If task has a commit SHA: only mark completed if that commit is pushed to origin
   * - If task has no commit SHA: don't mark completed (can't verify work is merged)
   *
   * This ensures GitHub issues are only closed when the actual work has been pushed.
   * Tasks completed with --no-commit will remain open in GitHub until manually closed.
   */
  private shouldMarkCompleted(task: Task, store?: TaskStore): boolean {
    // Task must be locally completed first
    if (!task.completed) {
      return false;
    }

    // If task has a commit SHA, verify it's been pushed
    const commitSha = task.metadata?.commit?.sha;
    if (commitSha) {
      return isCommitOnRemote(commitSha);
    }

    // For parent tasks (with store context): check if all descendants have verified commits
    if (store) {
      const descendants = collectDescendants(store.tasks, task.id);
      if (descendants.length > 0) {
        // Parent is "completed" only when ALL descendants have verified commits on remote
        return descendants.every((d) =>
          this.shouldMarkCompleted(d.task, store),
        );
      }
    }

    // Leaf task with no commit SHA - can't verify, don't close the issue
    return false;
  }

  /**
   * Get the reason why a completed task's issue won't be closed.
   * Returns undefined if the issue will be closed or the task isn't completed.
   */
  getIssueNotClosingReason(task: Task, store?: TaskStore): string | undefined {
    if (!task.completed) {
      return undefined;
    }

    if (this.shouldMarkCompleted(task, store)) {
      return undefined;
    }

    // For parent tasks: check if descendants are blocking
    if (store) {
      const descendants = collectDescendants(store.tasks, task.id);
      const blocking = descendants.filter(
        (d) => !this.shouldMarkCompleted(d.task, store),
      );
      if (blocking.length > 0) {
        const reasons = blocking.map(({ task: subtask }) =>
          this.getSubtaskBlockingReason(subtask),
        );
        return reasons.join("; ");
      }
    }

    // Leaf task or parent where own commit is the issue
    const commitSha = task.metadata?.commit?.sha;
    if (commitSha && !isCommitOnRemote(commitSha)) {
      return `commit ${commitSha.slice(0, 7)} not pushed to remote`;
    }

    return "completed without commit (use --no-commit to close manually)";
  }

  private getSubtaskBlockingReason(subtask: Task): string {
    const commitSha = subtask.metadata?.commit?.sha;
    if (commitSha && !isCommitOnRemote(commitSha)) {
      return `subtask ${subtask.id} commit ${commitSha.slice(0, 7)} not pushed`;
    }
    if (!subtask.completed) {
      return `subtask ${subtask.id} not completed`;
    }
    return `subtask ${subtask.id} completed without commit`;
  }

  /**
   * Reconcile subtasks from the remote issue body.
   * Compares remote subtask state with local and returns updates for stale local subtasks.
   *
   * This handles the scenario where:
   * 1. Task is completed on Machine A (with subtasks), synced to GitHub
   * 2. Machine B has stale local state (subtasks not completed)
   * 3. On sync, Machine B detects remote is newer and pulls subtask state
   */
  private reconcileSubtasksFromRemote(
    issueBody: string,
    store: TaskStore,
  ): SyncResult[] {
    const results: SyncResult[] = [];
    const { subtasks: remoteSubtasks } = parseHierarchicalIssueBody(issueBody);

    for (const remoteSubtask of remoteSubtasks) {
      const localSubtask = store.tasks.find((t) => t.id === remoteSubtask.id);
      if (!localSubtask) {
        // Subtask exists in remote but not locally - skip
        // (import flow handles this case)
        continue;
      }

      // Check if remote subtask is newer
      if (remoteSubtask.updated_at && localSubtask.updated_at) {
        const remoteUpdated = new Date(remoteSubtask.updated_at).getTime();
        const localUpdated = new Date(localSubtask.updated_at).getTime();

        if (remoteUpdated > localUpdated) {
          const localUpdates: Record<string, unknown> = {
            updated_at: remoteSubtask.updated_at,
          };

          // Pull completion state if remote is completed but local is not
          if (remoteSubtask.completed && !localSubtask.completed) {
            localUpdates.completed = true;
            localUpdates.completed_at = remoteSubtask.completed_at;
            localUpdates.result = remoteSubtask.result;
            localUpdates.started_at = remoteSubtask.started_at;
          }

          // Pull commit metadata if present in remote but not local
          if (
            remoteSubtask.metadata?.commit?.sha &&
            !localSubtask.metadata?.commit?.sha
          ) {
            localUpdates.metadata = {
              commit: remoteSubtask.metadata.commit,
            };
          }

          results.push({
            taskId: remoteSubtask.id,
            metadata: {}, // Subtasks don't have their own GitHub metadata
            created: false,
            skipped: true,
            localUpdates,
            pulledFromRemote: true,
          });
        }
      }
    }

    return results;
  }

  /**
   * Look up a task by its local ID in GitHub issues.
   * Used to find existing issues for tasks that don't have metadata yet.
   * Uses pagination to handle repos with >100 dex issues.
   */
  async findIssueByTaskId(taskId: string): Promise<number | null> {
    try {
      const issues = await this.octokit.paginate(
        this.octokit.issues.listForRepo,
        {
          owner: this.owner,
          repo: this.repo,
          labels: this.labelPrefix,
          state: "all",
          per_page: 100,
        },
      );

      for (const issue of issues) {
        if (issue.pull_request) continue;
        if (this.extractTaskIdFromBody(issue.body || "") === taskId) {
          return issue.number;
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Fetch all dex-labeled issues with pagination support.
   * Returns a Map keyed by task ID containing all data needed for change detection.
   */
  async fetchAllDexIssues(): Promise<Map<string, CachedIssue>> {
    const result = new Map<string, CachedIssue>();

    const issues = await this.octokit.paginate(
      this.octokit.issues.listForRepo,
      {
        owner: this.owner,
        repo: this.repo,
        labels: this.labelPrefix,
        state: "all",
        per_page: 100,
      },
    );

    for (const issue of issues) {
      if (issue.pull_request) continue;

      const taskId = this.extractTaskIdFromBody(issue.body || "");
      if (taskId) {
        const allLabels = (issue.labels || [])
          .map((l) => (typeof l === "string" ? l : l.name || ""))
          .filter((l) => l.length > 0);

        result.set(taskId, {
          number: issue.number,
          title: issue.title,
          body: issue.body || "",
          state: issue.state as "open" | "closed",
          labels: allLabels.filter((l) => l.startsWith(this.labelPrefix)),
          allLabels,
        });
      }
    }

    return result;
  }

  /**
   * Extract task ID from issue body.
   * Supports both new format (<!-- dex:task:id:{taskId} -->) and legacy format (<!-- dex:task:{taskId} -->).
   */
  private extractTaskIdFromBody(body: string): string | null {
    // Check new format: <!-- dex:task:id:{taskId} -->
    const newMatch = body.match(/<!-- dex:task:id:([a-z0-9]+) -->/);
    if (newMatch) return newMatch[1];

    // Check legacy format: <!-- dex:task:{taskId} -->
    const legacyMatch = body.match(/<!-- dex:task:([a-z0-9]+) -->/);
    if (legacyMatch) return legacyMatch[1];

    return null;
  }
}

/**
 * Extract GitHub issue number from task metadata.
 * Returns null if not synced yet.
 * Supports both new format (metadata.github.issueNumber) and legacy format (metadata.github_issue_number).
 */
export function getGitHubIssueNumber(task: Task): number | null {
  // New format
  if (task.metadata?.github?.issueNumber) {
    return task.metadata.github.issueNumber;
  }
  // Legacy format (from older imports)
  const legacyNumber = (task.metadata as Record<string, unknown> | undefined)
    ?.github_issue_number;
  if (typeof legacyNumber === "number") {
    return legacyNumber;
  }
  return null;
}
