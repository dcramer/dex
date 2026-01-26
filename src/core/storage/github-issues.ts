import { Octokit } from "@octokit/rest";
import { StorageEngine } from "./engine.js";
import { Task, TaskStore } from "../../types.js";
import { StorageError } from "../../errors.js";
import {
  parseIssueBody,
  renderIssueBody,
  parseSubtaskId,
  createSubtaskId,
  embeddedSubtaskToTask,
  taskToEmbeddedSubtask,
  getNextSubtaskIndex,
  EmbeddedSubtask,
} from "../github/issue-markdown.js";

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
      // Fetch all issues with dex label using pagination
      const issues = await this.octokit.paginate(this.octokit.issues.listForRepo, {
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

        // Add parent task
        tasks.push(this.issueToTask(issue));

        // Extract and add embedded subtasks
        const subtasks = this.extractSubtasks(issue);
        tasks.push(...subtasks);
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
      const existingIssues = await this.octokit.paginate(this.octokit.issues.listForRepo, {
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

      // Partition tasks into parents and subtasks
      const parentTasks: Task[] = [];
      const subtasksByParent = new Map<string, Task[]>();

      for (const task of store.tasks) {
        if (task.parent_id) {
          // This is a subtask
          const siblings = subtasksByParent.get(task.parent_id) || [];
          siblings.push(task);
          subtasksByParent.set(task.parent_id, siblings);
        } else {
          // This is a parent task
          parentTasks.push(task);
        }
      }

      // Check for orphaned subtasks (parent doesn't exist)
      const parentIds = new Set(parentTasks.map((t) => t.id));
      for (const [parentId, subtasks] of subtasksByParent) {
        if (!parentIds.has(parentId) && !existingIssueNumbers.has(parentId)) {
          console.warn(
            `Warning: ${subtasks.length} subtask(s) reference non-existent parent ${parentId}`
          );
        }
      }

      // Create or update parent tasks with their subtasks
      for (const parent of parentTasks) {
        const subtasks = subtasksByParent.get(parent.id) || [];

        if (existingIssueNumbers.has(parent.id)) {
          // Update existing issue with subtasks
          await this.updateIssueWithSubtasks(parent, subtasks);
        } else {
          // Create new issue with subtasks
          await this.createIssueWithSubtasks(parent, subtasks);
        }
      }

      // Handle subtasks for existing parents that weren't in the current parent list
      for (const [parentId, subtasks] of subtasksByParent) {
        if (!parentIds.has(parentId) && existingIssueNumbers.has(parentId)) {
          // Parent exists in GitHub but not in current store - update subtasks only
          await this.updateSubtasksOnly(parseInt(parentId, 10), subtasks);
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
   * Build labels array for a task
   */
  private buildLabels(task: Task): string[] {
    return [
      this.labelPrefix,
      `${this.labelPrefix}:priority-${task.priority}`,
      `${this.labelPrefix}:${task.completed ? "completed" : "pending"}`,
    ];
  }

  /**
   * Extract priority from issue labels
   */
  private extractPriority(labels: any[]): number {
    const prefix = `${this.labelPrefix}:priority-`;
    for (const label of labels) {
      const name = typeof label === "string" ? label : label.name;
      if (name?.startsWith(prefix)) {
        return parseInt(name.slice(prefix.length), 10) || 1;
      }
    }
    return 1;
  }

  /**
   * Convert GitHub issue to dex task (parent task only, subtasks parsed separately)
   */
  private issueToTask(issue: any): Task {
    const completed = issue.state === "closed";
    const priority = this.extractPriority(issue.labels);
    const parsed = parseIssueBody(issue.body || "");

    return {
      id: issue.number.toString(),
      parent_id: null,
      description: issue.title,
      context: parsed.context,
      priority,
      completed,
      result: null,
      metadata: null,
      created_at: issue.created_at,
      updated_at: issue.updated_at,
      completed_at: issue.closed_at,
      blockedBy: [],
      blocks: [],
      children: [],
    };
  }

  /**
   * Extract embedded subtasks from an issue body
   */
  private extractSubtasks(issue: any): Task[] {
    const parentId = issue.number.toString();
    const parsed = parseIssueBody(issue.body || "");

    return parsed.subtasks.map((subtask) =>
      embeddedSubtaskToTask(subtask, parentId)
    );
  }

  /**
   * Create a new GitHub issue with embedded subtasks
   */
  private async createIssueWithSubtasks(
    parent: Task,
    subtasks: Task[]
  ): Promise<void> {
    const embeddedSubtasks = subtasks.map(taskToEmbeddedSubtask);
    const body = renderIssueBody(parent.context, embeddedSubtasks);

    const { data: issue } = await this.octokit.issues.create({
      owner: this.owner,
      repo: this.repo,
      title: parent.description,
      body,
      labels: this.buildLabels(parent),
    });

    // Update the parent task ID to match the issue number
    const newParentId = issue.number.toString();
    parent.id = newParentId;

    // Update subtask IDs to use compound format
    for (let i = 0; i < subtasks.length; i++) {
      const parsedId = parseSubtaskId(subtasks[i].id);
      if (!parsedId || parsedId.parentId !== newParentId) {
        subtasks[i].id = createSubtaskId(newParentId, i + 1);
        subtasks[i].parent_id = newParentId;
      }
    }

    // If task is completed, close it
    if (parent.completed) {
      await this.octokit.issues.update({
        owner: this.owner,
        repo: this.repo,
        issue_number: issue.number,
        state: "closed",
      });
    }

    // If there's a result on the parent, add it as a comment
    if (parent.result) {
      await this.octokit.issues.createComment({
        owner: this.owner,
        repo: this.repo,
        issue_number: issue.number,
        body: `## Result\n\n${parent.result}`,
      });
    }
  }

  /**
   * Update an existing GitHub issue with embedded subtasks
   */
  private async updateIssueWithSubtasks(
    parent: Task,
    subtasks: Task[]
  ): Promise<void> {
    const issueNumber = parseInt(parent.id, 10);

    // Fetch current issue to get existing subtasks
    const { data: currentIssue } = await this.octokit.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
    });

    // Parse existing subtasks from current body
    const currentParsed = parseIssueBody(currentIssue.body || "");
    const embeddedSubtasks = this.assignSubtaskIds(
      subtasks,
      currentParsed.subtasks,
      parent.id
    );

    await this.octokit.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      title: parent.description,
      body: renderIssueBody(parent.context, embeddedSubtasks),
      labels: this.buildLabels(parent),
      state: parent.completed ? "closed" : "open",
    });
  }

  /**
   * Assign compound IDs to subtasks, preserving existing IDs where possible
   */
  private assignSubtaskIds(
    subtasks: Task[],
    existingSubtasks: EmbeddedSubtask[],
    parentId: string
  ): EmbeddedSubtask[] {
    const existingIds = new Set(existingSubtasks.map((s) => s.id));
    let nextIndex = getNextSubtaskIndex(existingSubtasks, parentId);

    return subtasks.map((task) => {
      const parsedId = parseSubtaskId(task.id);
      if ((parsedId && parsedId.parentId === parentId) || existingIds.has(task.id)) {
        return taskToEmbeddedSubtask(task);
      }
      task.id = createSubtaskId(parentId, nextIndex++);
      task.parent_id = parentId;
      return taskToEmbeddedSubtask(task);
    });
  }

  /**
   * Update only the subtasks section of an existing issue
   * Used when parent task is not in current store but subtasks need updating
   */
  private async updateSubtasksOnly(
    issueNumber: number,
    subtasks: Task[]
  ): Promise<void> {
    const { data: currentIssue } = await this.octokit.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
    });

    const currentParsed = parseIssueBody(currentIssue.body || "");
    const parentId = issueNumber.toString();

    // Merge: keep existing subtasks, add/update from input
    const subtaskMap = new Map<string, EmbeddedSubtask>(
      currentParsed.subtasks.map((s) => [s.id, s])
    );

    for (const embedded of this.assignSubtaskIds(subtasks, currentParsed.subtasks, parentId)) {
      subtaskMap.set(embedded.id, embedded);
    }

    await this.octokit.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      body: renderIssueBody(currentParsed.context, Array.from(subtaskMap.values())),
    });
  }
}
