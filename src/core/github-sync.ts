import { execSync } from "node:child_process";
import { Octokit } from "@octokit/rest";
import { Task, TaskStore } from "../types.js";
import { GitHubSyncConfig } from "./config.js";
import { getGitHubRepo, GitHubRepo } from "./git-remote.js";
import {
  collectDescendants,
  renderHierarchicalIssueBody,
  HierarchicalTask,
} from "./subtask-markdown.js";

/**
 * Get GitHub token from environment variable or gh CLI.
 * @param tokenEnv Environment variable name to check first (default: GITHUB_TOKEN)
 * @returns Token string or null if not found
 */
export function getGitHubToken(tokenEnv: string = "GITHUB_TOKEN"): string | null {
  // First try environment variable
  const envToken = process.env[tokenEnv];
  if (envToken) {
    return envToken;
  }

  // Fall back to gh CLI
  try {
    const token = execSync("gh auth token", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (token) {
      return token;
    }
  } catch {
    // gh CLI not available or not authenticated
  }

  return null;
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

/**
 * GitHub Sync Service
 *
 * Provides automatic syncing of tasks to GitHub Issues as an enhancement layer.
 * File storage remains the source of truth - this is a one-way push sync.
 *
 * Behavior:
 * - Top-level tasks (no parent_id) → Create/update GitHub Issue
 * - Subtasks → Embedded in parent issue body as markdown
 * - Task metadata (description, context) → Synced from local filesystem
 * - Completion status → Only synced when pushed to git remote
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
   * Sync a single task to GitHub.
   * For subtasks, syncs the parent issue instead.
   */
  async syncTask(task: Task, store: TaskStore): Promise<void> {
    // If this is a subtask, sync the parent instead
    if (task.parent_id) {
      const parent = store.tasks.find((t) => t.id === task.parent_id);
      if (parent) {
        await this.syncTask(parent, store);
      }
      return;
    }

    await this.syncParentTask(task, store);
  }

  /**
   * Sync all tasks to GitHub.
   */
  async syncAll(store: TaskStore): Promise<void> {
    const parentTasks = store.tasks.filter((t) => !t.parent_id);
    for (const parent of parentTasks) {
      await this.syncParentTask(parent, store);
    }
  }

  /**
   * Sync a parent task (with all descendants) to GitHub.
   */
  private async syncParentTask(parent: Task, store: TaskStore): Promise<void> {
    // Collect ALL descendants, not just immediate children
    const descendants = collectDescendants(store.tasks, parent.id);
    const issueNumber = this.getGitHubIssueNumber(parent);

    if (issueNumber) {
      await this.updateIssue(parent, descendants, issueNumber);
    } else {
      await this.createIssue(parent, descendants);
    }
  }

  /**
   * Create a new GitHub issue for a task.
   * Note: Issue is only closed if completion has been pushed to remote.
   */
  private async createIssue(
    parent: Task,
    descendants: HierarchicalTask[]
  ): Promise<number> {
    const body = this.renderBody(parent.context, descendants, parent.id);
    const remoteCompleted = this.isTaskCompletedOnRemote(parent.id);

    const { data: issue } = await this.octokit.issues.create({
      owner: this.owner,
      repo: this.repo,
      title: parent.description,
      body,
      labels: this.buildLabels(parent, remoteCompleted),
    });

    // Only close if completion has been pushed to remote
    if (remoteCompleted) {
      await this.octokit.issues.update({
        owner: this.owner,
        repo: this.repo,
        issue_number: issue.number,
        state: "closed",
      });
    }

    // Add result as comment if present and pushed
    if (parent.result && remoteCompleted) {
      await this.octokit.issues.createComment({
        owner: this.owner,
        repo: this.repo,
        issue_number: issue.number,
        body: `## Result\n\n${parent.result}`,
      });
    }

    return issue.number;
  }

  /**
   * Update an existing GitHub issue.
   * Note: Issue is only closed if completion has been pushed to remote.
   */
  private async updateIssue(
    parent: Task,
    descendants: HierarchicalTask[],
    issueNumber: number
  ): Promise<void> {
    const body = this.renderBody(parent.context, descendants, parent.id);
    const remoteCompleted = this.isTaskCompletedOnRemote(parent.id);

    await this.octokit.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      title: parent.description,
      body,
      labels: this.buildLabels(parent, remoteCompleted),
      state: remoteCompleted ? "closed" : "open",
    });
  }

  /**
   * Render the issue body with hierarchical task tree.
   */
  private renderBody(
    context: string,
    descendants: HierarchicalTask[],
    taskId: string
  ): string {
    const body = renderHierarchicalIssueBody(context, descendants);
    // Add task ID as hidden comment for reference
    return `<!-- dex:task:${taskId} -->\n${body}`;
  }

  /**
   * Build labels for a task.
   * Uses remote completion state for the status label.
   */
  private buildLabels(task: Task, remoteCompleted: boolean): string[] {
    return [
      this.labelPrefix,
      `${this.labelPrefix}:priority-${task.priority}`,
      `${this.labelPrefix}:${remoteCompleted ? "completed" : "pending"}`,
    ];
  }

  /**
   * Extract GitHub issue number from task metadata.
   * Returns null if not synced yet.
   */
  private getGitHubIssueNumber(task: Task): number | null {
    return getGitHubIssueNumber(task);
  }

  /**
   * Check if a task is marked as completed on the remote branch.
   * Only returns true if the task file exists on origin/HEAD and has completed=true.
   * This ensures we only close GitHub issues when completion has been pushed.
   */
  private isTaskCompletedOnRemote(taskId: string): boolean {
    try {
      const result = execSync(
        `git show origin/HEAD:${this.storagePath}/tasks/${taskId}.json 2>/dev/null`,
        { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }
      );
      const task = JSON.parse(result);
      return task.completed === true;
    } catch {
      // File doesn't exist on remote, parse error, or no remote tracking
      return false;
    }
  }

  /**
   * Look up a task by its local ID in GitHub issues.
   * Used to find existing issues for tasks that don't have metadata yet.
   */
  async findIssueByTaskId(taskId: string): Promise<number | null> {
    try {
      const { data: issues } = await this.octokit.issues.listForRepo({
        owner: this.owner,
        repo: this.repo,
        labels: this.labelPrefix,
        state: "all",
        per_page: 100,
      });

      for (const issue of issues) {
        if (issue.pull_request) continue;
        const body = issue.body || "";
        if (body.includes(`<!-- dex:task:${taskId} -->`)) {
          return issue.number;
        }
      }
      return null;
    } catch {
      return null;
    }
  }
}

/**
 * Extract GitHub issue number from task metadata.
 * Returns null if not synced yet.
 */
export function getGitHubIssueNumber(task: Task): number | null {
  const metadata = task.metadata as Record<string, unknown> | null;
  if (metadata && typeof metadata.github_issue_number === "number") {
    return metadata.github_issue_number;
  }
  return null;
}

/**
 * Create a GitHubSyncService for auto-sync if enabled in config.
 * Returns null if auto-sync is disabled, no git remote, or no token.
 *
 * @param config Sync config from dex.toml
 * @param storagePath Path to task storage (default: ".dex")
 */
export function createGitHubSyncService(
  config: GitHubSyncConfig | undefined,
  storagePath?: string
): GitHubSyncService | null {
  if (!config?.enabled) {
    return null;
  }

  const repo = getGitHubRepo();
  if (!repo) {
    console.warn("GitHub sync enabled but no GitHub remote found. Sync disabled.");
    return null;
  }

  const tokenEnv = config.token_env || "GITHUB_TOKEN";
  const token = getGitHubToken(tokenEnv);

  if (!token) {
    console.warn(`GitHub sync enabled but no token found (checked ${tokenEnv} and gh CLI). Sync disabled.`);
    return null;
  }

  return new GitHubSyncService({
    repo,
    token,
    labelPrefix: config.label_prefix,
    storagePath,
  });
}

/**
 * Create a GitHubSyncService for manual sync/import commands.
 * Throws descriptive errors if requirements are not met.
 *
 * @param config Optional sync config for label_prefix and token_env
 * @param storagePath Path to task storage (default: ".dex")
 */
export function createGitHubSyncServiceOrThrow(
  config?: GitHubSyncConfig,
  storagePath?: string
): GitHubSyncService {
  const repo = getGitHubRepo();
  if (!repo) {
    throw new Error(
      "Cannot determine GitHub repository.\n" +
      "This directory is not in a git repository with a GitHub remote."
    );
  }

  const tokenEnv = config?.token_env || "GITHUB_TOKEN";
  const token = getGitHubToken(tokenEnv);

  if (!token) {
    throw new Error(
      `GitHub token not found.\n` +
      `Set ${tokenEnv} environment variable or authenticate with: gh auth login`
    );
  }

  return new GitHubSyncService({
    repo,
    token,
    labelPrefix: config?.label_prefix,
    storagePath,
  });
}
