import { Octokit } from "@octokit/rest";
import { StorageEngine } from "./storage-engine.js";
import { Task, TaskStore, TaskStatus } from "../types.js";
import { StorageError, DataCorruptionError } from "../errors.js";
import {
  parseIssueBody,
  renderIssueBody,
  parseSubtaskId,
  createSubtaskId,
  taskToEmbeddedSubtask,
  embeddedSubtaskToTask,
  getNextSubtaskIndex,
  EmbeddedSubtask,
} from "./subtask-markdown.js";

export interface GitHubIssuesConfig {
  /** Repository owner */
  owner: string;
  /** Repository name */
  repo: string;
  /** GitHub personal access token */
  token: string;
  /** Label prefix for dex tasks (default: "dex") */
  labelPrefix?: string;
}

/**
 * Storage backend using GitHub Issues.
 *
 * Maps dex tasks to GitHub issues:
 * - id → issue.number (as string)
 * - description → issue.title
 * - context → issue.body
 * - result → comment with ## Result header
 * - status → issue.state + labels (dex:pending, dex:completed)
 * - priority → label (dex:priority-0, dex:priority-1, etc.)
 * - parent_id → sub-issues (if available)
 * - timestamps → issue created/updated/closed_at
 */
export class GitHubIssuesStorage implements StorageEngine {
  private octokit: Octokit;
  private owner: string;
  private repo: string;
  private labelPrefix: string;

  constructor(config: GitHubIssuesConfig) {
    this.octokit = new Octokit({
      auth: config.token,
    });
    this.owner = config.owner;
    this.repo = config.repo;
    this.labelPrefix = config.labelPrefix || "dex";
  }

  /**
   * Synchronous read - not supported for GitHub Issues
   * @throws Always throws - use readAsync instead
   */
  read(): TaskStore {
    throw new StorageError(
      "GitHubIssuesStorage requires async operations. Use readAsync() instead.",
      undefined,
      "GitHub API requires async operations"
    );
  }

  /**
   * Read all tasks from GitHub Issues (async)
   */
  async readAsync(): Promise<TaskStore> {
    try {
      // Fetch all issues with dex label
      const { data: issues } = await this.octokit.issues.listForRepo({
        owner: this.owner,
        repo: this.repo,
        labels: this.labelPrefix,
        state: "all",
        per_page: 100,
      });

      const tasks: Task[] = [];

      for (const issue of issues) {
        // Skip pull requests
        if (issue.pull_request) {
          continue;
        }

        // Convert issue to parent task
        const parentTask = this.issueToTask(issue);
        tasks.push(parentTask);

        // Parse embedded subtasks from issue body
        const { subtasks } = parseIssueBody(issue.body || "");
        for (const subtask of subtasks) {
          tasks.push(embeddedSubtaskToTask(subtask, parentTask.id));
        }
      }

      return { tasks };
    } catch (err) {
      const originalError = err instanceof Error ? err : undefined;
      throw new StorageError(
        `Failed to read from GitHub Issues (${this.owner}/${this.repo})`,
        originalError,
        "Check token permissions and repository access"
      );
    }
  }

  /**
   * Write tasks to GitHub Issues
   */
  async writeAsync(store: TaskStore): Promise<void> {
    try {
      // Fetch existing issues to determine what needs to be created/updated/deleted
      const { data: existingIssues } = await this.octokit.issues.listForRepo({
        owner: this.owner,
        repo: this.repo,
        labels: this.labelPrefix,
        state: "all",
        per_page: 100,
      });

      const existingIssueNumbers = new Set(
        existingIssues
          .filter((issue) => !issue.pull_request)
          .map((issue) => issue.number.toString())
      );

      // Partition tasks into parents (no parent_id) and subtasks (have parent_id)
      const parentTasks: Task[] = [];
      const subtasksByParent = new Map<string, Task[]>();

      for (const task of store.tasks) {
        if (task.parent_id) {
          // This is a subtask
          const parentSubtasks = subtasksByParent.get(task.parent_id) || [];
          parentSubtasks.push(task);
          subtasksByParent.set(task.parent_id, parentSubtasks);
        } else {
          // This is a parent task
          parentTasks.push(task);
        }
      }

      // Build a set of parent IDs for orphan detection
      const parentIds = new Set(parentTasks.map((t) => t.id));

      // Warn about orphaned subtasks (subtasks whose parent doesn't exist)
      for (const [parentId, subtasks] of subtasksByParent) {
        if (!parentIds.has(parentId)) {
          console.warn(
            `Warning: ${subtasks.length} orphaned subtask(s) found for non-existent parent "${parentId}". These will be skipped.`
          );
        }
      }

      // Create or update parent tasks with their embedded subtasks
      for (const parentTask of parentTasks) {
        const subtasks = subtasksByParent.get(parentTask.id) || [];

        if (existingIssueNumbers.has(parentTask.id)) {
          // Update existing issue with subtasks
          await this.updateIssueWithSubtasks(parentTask, subtasks);
        } else {
          // Create new issue with subtasks
          await this.createIssueWithSubtasks(parentTask, subtasks);
        }
      }

      // Note: We don't automatically delete issues that are removed from the store
      // This is intentional - GitHub issues are valuable history even if removed from dex
    } catch (err) {
      const originalError = err instanceof Error ? err : undefined;
      throw new StorageError(
        `Failed to write to GitHub Issues (${this.owner}/${this.repo})`,
        originalError,
        "Check token permissions (needs repo scope)"
      );
    }
  }

  /**
   * Synchronous write - not supported for GitHub Issues
   * @throws Always throws - use writeAsync instead
   */
  write(store: TaskStore): void {
    throw new StorageError(
      "GitHubIssuesStorage requires async operations. Use writeAsync() instead.",
      undefined,
      "GitHub API requires async operations"
    );
  }

  /**
   * Get storage identifier
   */
  getIdentifier(): string {
    return `${this.owner}/${this.repo}`;
  }

  /**
   * GitHub Issues storage is async-only
   */
  isSync(): boolean {
    return false;
  }

  /**
   * Convert GitHub issue to dex task (parent task only, excludes embedded subtasks)
   */
  private issueToTask(issue: any): Task {
    // Extract status from issue state and labels
    const status: TaskStatus =
      issue.state === "closed" ? "completed" : "pending";

    // Extract priority from labels
    const priorityLabel = issue.labels.find((label: any) =>
      typeof label === "string"
        ? label.startsWith(`${this.labelPrefix}:priority-`)
        : label.name?.startsWith(`${this.labelPrefix}:priority-`)
    );
    const priorityMatch = priorityLabel
      ? typeof priorityLabel === "string"
        ? priorityLabel.match(/priority-(\d+)/)
        : priorityLabel.name?.match(/priority-(\d+)/)
      : null;
    const priority = priorityMatch ? parseInt(priorityMatch[1], 10) : 1;

    // Extract result from comments (look for ## Result header)
    let result: string | null = null;
    // Note: Fetching comments would require an additional API call
    // For now, we'll leave result extraction as a future enhancement

    // Parent tasks have no parent_id
    const parent_id: string | null = null;

    // Extract only parent context (before ## Subtasks section)
    const { context } = parseIssueBody(issue.body || "");

    return {
      id: issue.number.toString(),
      parent_id,
      description: issue.title,
      context,
      priority,
      status,
      result,
      created_at: issue.created_at,
      updated_at: issue.updated_at,
      completed_at: issue.closed_at,
    };
  }

  /**
   * Create a new GitHub issue for a parent task with embedded subtasks
   */
  private async createIssueWithSubtasks(
    task: Task,
    subtasks: Task[]
  ): Promise<void> {
    const labels = [
      this.labelPrefix,
      `${this.labelPrefix}:priority-${task.priority}`,
    ];

    if (task.status === "completed") {
      labels.push(`${this.labelPrefix}:completed`);
    } else {
      labels.push(`${this.labelPrefix}:pending`);
    }

    // Create the issue first to get the issue number
    const { data: issue } = await this.octokit.issues.create({
      owner: this.owner,
      repo: this.repo,
      title: task.description,
      body: task.context, // Initial body without subtasks
      labels,
    });

    // Update the task ID to match the issue number
    const issueNumber = issue.number;
    task.id = issueNumber.toString();

    // If there are subtasks, assign IDs and update the issue body
    if (subtasks.length > 0) {
      const embeddedSubtasks: EmbeddedSubtask[] = [];
      let nextIndex = 1;

      for (const subtask of subtasks) {
        // Assign compound ID if not already set
        if (!subtask.id || !parseSubtaskId(subtask.id)) {
          subtask.id = createSubtaskId(task.id, nextIndex);
          nextIndex++;
        } else {
          // Update parent portion of compound ID to match new issue number
          const parsed = parseSubtaskId(subtask.id);
          if (parsed) {
            subtask.id = createSubtaskId(task.id, parsed.localIndex);
            nextIndex = Math.max(nextIndex, parsed.localIndex + 1);
          }
        }

        embeddedSubtasks.push(taskToEmbeddedSubtask(subtask));
      }

      // Render body with embedded subtasks
      const bodyWithSubtasks = renderIssueBody(task.context, embeddedSubtasks);

      await this.octokit.issues.update({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        body: bodyWithSubtasks,
      });
    }

    // If there's a result, add it as a comment
    if (task.result) {
      await this.octokit.issues.createComment({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        body: `## Result\n\n${task.result}`,
      });
    }

    // Close the issue if completed
    if (task.status === "completed") {
      await this.octokit.issues.update({
        owner: this.owner,
        repo: this.repo,
        issue_number: issueNumber,
        state: "closed",
      });
    }
  }

  /**
   * Update an existing GitHub issue with embedded subtasks
   */
  private async updateIssueWithSubtasks(
    task: Task,
    subtasks: Task[]
  ): Promise<void> {
    const issueNumber = parseInt(task.id, 10);

    const labels = [
      this.labelPrefix,
      `${this.labelPrefix}:priority-${task.priority}`,
    ];

    if (task.status === "completed") {
      labels.push(`${this.labelPrefix}:completed`);
    } else {
      labels.push(`${this.labelPrefix}:pending`);
    }

    // Fetch current issue to get existing subtasks
    const { data: currentIssue } = await this.octokit.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
    });

    // Parse existing subtasks from current body
    const { subtasks: existingSubtasks } = parseIssueBody(
      currentIssue.body || ""
    );

    // Build a map of existing subtasks by ID for merging
    const existingSubtaskMap = new Map<string, EmbeddedSubtask>();
    for (const existing of existingSubtasks) {
      if (existing.id) {
        existingSubtaskMap.set(existing.id, existing);
      }
    }

    // Process new/updated subtasks
    const embeddedSubtasks: EmbeddedSubtask[] = [];
    const nextIndex = getNextSubtaskIndex(existingSubtasks);
    let currentIndex = nextIndex;

    for (const subtask of subtasks) {
      // Assign compound ID if not already a valid compound ID
      if (!subtask.id || !parseSubtaskId(subtask.id)) {
        subtask.id = createSubtaskId(task.id, currentIndex);
        currentIndex++;
      }

      embeddedSubtasks.push(taskToEmbeddedSubtask(subtask));
    }

    // Render body with embedded subtasks
    const bodyWithSubtasks = renderIssueBody(task.context, embeddedSubtasks);

    await this.octokit.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      title: task.description,
      body: bodyWithSubtasks,
      labels,
      state: task.status === "completed" ? "closed" : "open",
    });

    // TODO: Handle result updates (check if result comment exists, update or create)
  }
}
