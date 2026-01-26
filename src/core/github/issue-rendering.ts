import { Task, CommitMetadata } from "../../types.js";
import {
  encodeMetadataValue,
  EmbeddedSubtask,
  HierarchicalTask,
  SUBTASKS_HEADER,
} from "./issue-parsing.js";

/**
 * Create a compound subtask ID from parent ID and index.
 * @param parentId - The parent issue number
 * @param index - The local subtask index (1-based)
 * @returns The compound ID string
 */
export function createSubtaskId(parentId: string, index: number): string {
  return `${parentId}-${index}`;
}

/**
 * Render an issue body with embedded subtasks.
 * @param context - The parent task context
 * @param subtasks - Array of subtasks to embed
 * @returns The rendered markdown body
 */
export function renderIssueBody(
  context: string,
  subtasks: EmbeddedSubtask[],
): string {
  if (subtasks.length === 0) {
    return context;
  }

  const subtaskBlocks = subtasks.map(renderSubtaskBlock).join("\n\n");

  return `${context}\n\n${SUBTASKS_HEADER}\n\n${subtaskBlocks}`;
}

/** Common task fields needed for rendering metadata */
interface TaskLike {
  id: string;
  priority: number;
  completed: boolean;
  description: string;
  result: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  metadata: { commit?: CommitMetadata } | null;
}

/**
 * Render the metadata comments, context, and result sections shared by all task blocks.
 * @param task - The task to render metadata for
 * @param parentId - Optional parent ID for hierarchical tasks
 */
function renderTaskMetadataAndContent(
  task: TaskLike,
  parentId?: string | null,
): string[] {
  const lines: string[] = [];

  lines.push(`<!-- dex:subtask:id:${task.id} -->`);
  if (parentId) {
    lines.push(`<!-- dex:subtask:parent:${parentId} -->`);
  }
  lines.push(`<!-- dex:subtask:priority:${task.priority} -->`);
  lines.push(`<!-- dex:subtask:completed:${task.completed} -->`);
  lines.push(`<!-- dex:subtask:created_at:${task.created_at} -->`);
  lines.push(`<!-- dex:subtask:updated_at:${task.updated_at} -->`);
  lines.push(
    `<!-- dex:subtask:completed_at:${task.completed_at ?? "null"} -->`,
  );

  if (task.metadata?.commit) {
    const commit = task.metadata.commit;
    lines.push(`<!-- dex:subtask:commit_sha:${commit.sha} -->`);
    if (commit.message) {
      lines.push(
        `<!-- dex:subtask:commit_message:${encodeMetadataValue(commit.message)} -->`,
      );
    }
    if (commit.branch) {
      lines.push(`<!-- dex:subtask:commit_branch:${commit.branch} -->`);
    }
    if (commit.url) {
      lines.push(`<!-- dex:subtask:commit_url:${commit.url} -->`);
    }
    if (commit.timestamp) {
      lines.push(`<!-- dex:subtask:commit_timestamp:${commit.timestamp} -->`);
    }
  }

  lines.push("");

  if (task.description) {
    lines.push("### Description");
    lines.push(task.description);
    lines.push("");
  }

  if (task.result) {
    lines.push("### Result");
    lines.push(task.result);
    lines.push("");
  }

  return lines;
}

/**
 * Render a single subtask as a <details> block.
 */
function renderSubtaskBlock(subtask: EmbeddedSubtask): string {
  const checkbox = subtask.completed ? "x" : " ";

  return [
    "<details>",
    `<summary>[${checkbox}] ${subtask.name}</summary>`,
    ...renderTaskMetadataAndContent(subtask),
    "</details>",
  ].join("\n");
}

/**
 * Render an issue body with hierarchical task tree and details.
 * @param context - The root task context
 * @param descendants - All descendant tasks with hierarchy info
 * @returns The rendered markdown body
 */
export function renderHierarchicalIssueBody(
  context: string,
  descendants: HierarchicalTask[],
): string {
  if (descendants.length === 0) {
    return context;
  }

  const lines: string[] = [context, ""];

  // Task Tree section - quick overview with checkboxes
  lines.push("## Task Tree");
  lines.push("");
  for (const { task, depth } of descendants) {
    const indent = "  ".repeat(depth);
    const checkbox = task.completed ? "x" : " ";
    lines.push(`${indent}- [${checkbox}] **${task.name}** \`${task.id}\``);
  }
  lines.push("");

  // Task Details section - expandable details for each task
  lines.push("## Task Details");
  lines.push("");
  for (const { task, depth, parentId } of descendants) {
    lines.push(renderHierarchicalTaskBlock(task, depth, parentId));
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * Render a single task as a <details> block with depth indicator.
 */
function renderHierarchicalTaskBlock(
  task: Task,
  depth: number,
  parentId: string | null,
): string {
  const checkbox = task.completed ? "x" : " ";
  const depthArrow = depth > 0 ? "↳".repeat(depth) + " " : "";

  return [
    "<details>",
    `<summary>[${checkbox}] ${depthArrow}<b>${task.name}</b> <code>${task.id}</code></summary>`,
    ...renderTaskMetadataAndContent(task, parentId),
    "</details>",
  ].join("\n");
}
