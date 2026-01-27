import { Octokit } from "@octokit/rest";
import { GithubMetadata, Task, TaskStore } from "../../types.js";
import { GitHubRepo } from "./remote.js";
import {
  collectDescendants,
  renderHierarchicalIssueBody,
  HierarchicalTask,
  encodeMetadataValue,
} from "./issue-markdown.js";
import { isCommitOnRemote } from "../git-utils.js";

/**
 * Result of syncing a task to GitHub.
 * Contains the github metadata that should be saved to the task.
 */
export interface SyncResult {
  taskId: string;
  github: GithubMetadata;
  created: boolean;
  /** True if task was skipped because nothing changed */
  skipped?: boolean;
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
 * Cached issue data for efficient sync operations.
 * Contains all data needed for change detection without re-fetching.
 */
export interface CachedIssue {
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: string[];
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
    skipped?: boolean,
  ): SyncResult {
    return {
      taskId,
      github: {
        issueNumber,
        issueUrl: `https://github.com/${this.owner}/${this.repo}/issues/${issueNumber}`,
        repo: this.getRepoString(),
        state,
      },
      created,
      skipped,
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
    const descendants = collectDescendants(store.tasks, parent.id);

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
    const shouldClose = this.shouldMarkCompleted(parent);

    // Determine expected state for GitHub issue
    const expectedState = shouldClose ? "closed" : "open";

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
          true,
        );
      }

      // Check if we can skip this update by comparing with GitHub
      if (skipUnchanged) {
        const expectedBody = this.renderBody(parent, descendants);
        const expectedLabels = this.buildLabels(parent, shouldClose);

        // Use cached data for change detection when available
        const cached = issueCache?.get(parent.id);
        const hasChanges = cached
          ? this.hasIssueChangedFromCache(
              cached,
              parent.name,
              expectedBody,
              expectedLabels,
              shouldClose,
            )
          : await this.hasIssueChanged(
              issueNumber,
              parent.name,
              expectedBody,
              expectedLabels,
              shouldClose,
            );

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

      await this.updateIssue(parent, descendants, issueNumber, shouldClose);
      return this.buildSyncResult(parent.id, issueNumber, false, expectedState);
    } else {
      onProgress?.({
        current: currentIndex,
        total,
        task: parent,
        phase: "creating",
      });

      const github = await this.createIssue(parent, descendants, shouldClose);
      return { taskId: parent.id, github, created: true };
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
   * Check if an issue has changed compared to what we would push.
   * Returns true if the issue needs updating.
   */
  private async hasIssueChanged(
    issueNumber: number,
    expectedTitle: string,
    expectedBody: string,
    expectedLabels: string[],
    shouldClose: boolean,
  ): Promise<boolean> {
    try {
      const { data: issue } = await this.octokit.issues.get({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
      });

      const labels = (issue.labels || [])
        .map((l) => (typeof l === "string" ? l : l.name || ""))
        .filter((l) => l.startsWith(this.labelPrefix));

      return this.issueNeedsUpdate(
        {
          title: issue.title,
          body: issue.body || "",
          state: issue.state,
          labels,
        },
        expectedTitle,
        expectedBody,
        expectedLabels,
        shouldClose,
      );
    } catch {
      // If we can't fetch the issue, assume it needs updating
      return true;
    }
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
   */
  private async updateIssue(
    parent: Task,
    descendants: HierarchicalTask[],
    issueNumber: number,
    shouldClose: boolean,
  ): Promise<void> {
    const body = this.renderBody(parent, descendants);

    await this.octokit.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      title: parent.name,
      body,
      labels: this.buildLabels(parent, shouldClose),
      state: shouldClose ? "closed" : "open",
    });
  }

  /**
   * Render the issue body with hierarchical task tree.
   * Includes root task metadata encoded in HTML comments for round-trip support.
   */
  private renderBody(task: Task, descendants: HierarchicalTask[]): string {
    // Build root task metadata comments
    const rootMeta: string[] = [
      `<!-- dex:task:id:${task.id} -->`,
      `<!-- dex:task:priority:${task.priority} -->`,
      `<!-- dex:task:completed:${task.completed} -->`,
      `<!-- dex:task:created_at:${task.created_at} -->`,
      `<!-- dex:task:updated_at:${task.updated_at} -->`,
      `<!-- dex:task:completed_at:${task.completed_at ?? "null"} -->`,
    ];

    // Add result if present (base64 encoded for multi-line support)
    if (task.result) {
      rootMeta.push(
        `<!-- dex:task:result:${encodeMetadataValue(task.result)} -->`,
      );
    }

    // Add commit metadata if present
    if (task.metadata?.commit) {
      const commit = task.metadata.commit;
      rootMeta.push(`<!-- dex:task:commit_sha:${commit.sha} -->`);
      if (commit.message) {
        rootMeta.push(
          `<!-- dex:task:commit_message:${encodeMetadataValue(commit.message)} -->`,
        );
      }
      if (commit.branch) {
        rootMeta.push(`<!-- dex:task:commit_branch:${commit.branch} -->`);
      }
      if (commit.url) {
        rootMeta.push(`<!-- dex:task:commit_url:${commit.url} -->`);
      }
      if (commit.timestamp) {
        rootMeta.push(`<!-- dex:task:commit_timestamp:${commit.timestamp} -->`);
      }
    }

    const body = renderHierarchicalIssueBody(task.description, descendants);
    return `${rootMeta.join("\n")}\n${body}`;
  }

  /**
   * Build labels for a task.
   */
  private buildLabels(task: Task, shouldClose: boolean): string[] {
    return [
      this.labelPrefix,
      `${this.labelPrefix}:priority-${task.priority}`,
      `${this.labelPrefix}:${shouldClose ? "completed" : "pending"}`,
    ];
  }

  /**
   * Determine if a task should be marked as completed in GitHub.
   *
   * If task has a commit SHA: only mark completed if that commit is pushed to origin
   * If task has no commit SHA: use local completion status (can't verify push status)
   *
   * This ensures GitHub issues are only closed when the actual work has been pushed.
   */
  private shouldMarkCompleted(task: Task): boolean {
    // Task must be locally completed first
    if (!task.completed) {
      return false;
    }

    // If task has a commit SHA, verify it's been pushed
    const commitSha = task.metadata?.commit?.sha;
    if (commitSha) {
      return isCommitOnRemote(commitSha);
    }

    // No commit SHA - use local completion status (can't verify push)
    return true;
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
        result.set(taskId, {
          number: issue.number,
          title: issue.title,
          body: issue.body || "",
          state: issue.state as "open" | "closed",
          labels: (issue.labels || [])
            .map((l) => (typeof l === "string" ? l : l.name || ""))
            .filter((l) => l.startsWith(this.labelPrefix)),
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
