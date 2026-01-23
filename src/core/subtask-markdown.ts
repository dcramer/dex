import { Task, TaskStatus } from "../types.js";

/**
 * Represents a subtask parsed from or to be embedded in a GitHub issue body.
 */
export type EmbeddedSubtask = Omit<Task, "parent_id">;

/**
 * Result of parsing an issue body.
 */
export interface ParsedIssueBody {
  context: string;
  subtasks: EmbeddedSubtask[];
}

/**
 * Result of parsing a compound subtask ID.
 */
export interface ParsedSubtaskId {
  parentId: string;
  localIndex: number;
}

const SUBTASKS_HEADER = "## Subtasks";

/**
 * Parse a compound subtask ID into its components.
 * @param id - The compound ID (e.g., "9-1")
 * @returns Parsed components or null if not a valid compound ID
 */
export function parseSubtaskId(id: string): ParsedSubtaskId | null {
  const match = id.match(/^(\d+)-(\d+)$/);
  if (!match) {
    return null;
  }
  return {
    parentId: match[1],
    localIndex: parseInt(match[2], 10),
  };
}

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
 * Parse an issue body to extract context and embedded subtasks.
 * @param body - The GitHub issue body
 * @returns Parsed context and subtasks
 */
export function parseIssueBody(body: string): ParsedIssueBody {
  const subtasksIndex = body.indexOf(SUBTASKS_HEADER);

  if (subtasksIndex === -1) {
    return {
      context: body.trim(),
      subtasks: [],
    };
  }

  const context = body.slice(0, subtasksIndex).trim();
  const subtasksSection = body.slice(subtasksIndex + SUBTASKS_HEADER.length);

  const subtasks = parseSubtasksSection(subtasksSection);

  return { context, subtasks };
}

/**
 * Parse the subtasks section to extract individual subtasks from <details> blocks.
 */
function parseSubtasksSection(section: string): EmbeddedSubtask[] {
  const subtasks: EmbeddedSubtask[] = [];

  // Match each <details>...</details> block
  const detailsRegex = /<details>([\s\S]*?)<\/details>/g;
  let match;

  while ((match = detailsRegex.exec(section)) !== null) {
    const detailsContent = match[1];
    const subtask = parseDetailsBlock(detailsContent);
    if (subtask) {
      subtasks.push(subtask);
    }
  }

  return subtasks;
}

/**
 * Parse a single <details> block into a subtask.
 */
function parseDetailsBlock(content: string): EmbeddedSubtask | null {
  // Extract summary (description and checkbox status)
  const summaryMatch = content.match(
    /<summary>\s*\[([ x])\]\s*(.*?)\s*<\/summary>/i
  );
  if (!summaryMatch) {
    return null;
  }

  const isCompleted = summaryMatch[1].toLowerCase() === "x";
  const description = summaryMatch[2].trim();

  // Extract metadata from HTML comments
  const metadata = parseMetadataComments(content);
  if (!metadata.id) {
    return null;
  }

  // Extract context (### Context section)
  const contextMatch = content.match(
    /### Context\s*\n([\s\S]*?)(?=###|$)/
  );
  const context = contextMatch ? contextMatch[1].trim() : "";

  // Extract result (### Result section)
  const resultMatch = content.match(/### Result\s*\n([\s\S]*?)(?=###|$)/);
  const result = resultMatch ? resultMatch[1].trim() : null;

  return {
    id: metadata.id,
    description,
    context,
    priority: metadata.priority ?? 1,
    status: metadata.status ?? (isCompleted ? "completed" : "pending"),
    result,
    created_at: metadata.created_at ?? new Date().toISOString(),
    updated_at: metadata.updated_at ?? new Date().toISOString(),
    completed_at: metadata.completed_at ?? null,
  };
}

/**
 * Parse metadata from HTML comments in a details block.
 */
function parseMetadataComments(content: string): {
  id?: string;
  priority?: number;
  status?: TaskStatus;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
} {
  const metadata: ReturnType<typeof parseMetadataComments> = {};

  // Match all dex:subtask: comments
  const commentRegex = /<!-- dex:subtask:(\w+):(.*?) -->/g;
  let match;

  while ((match = commentRegex.exec(content)) !== null) {
    const [, key, value] = match;
    switch (key) {
      case "id":
        metadata.id = value;
        break;
      case "priority":
        metadata.priority = parseInt(value, 10);
        break;
      case "status":
        if (value === "pending" || value === "completed") {
          metadata.status = value;
        }
        break;
      case "created_at":
        metadata.created_at = value;
        break;
      case "updated_at":
        metadata.updated_at = value;
        break;
      case "completed_at":
        metadata.completed_at = value === "null" ? null : value;
        break;
    }
  }

  return metadata;
}

/**
 * Render an issue body with embedded subtasks.
 * @param context - The parent task context
 * @param subtasks - Array of subtasks to embed
 * @returns The rendered markdown body
 */
export function renderIssueBody(
  context: string,
  subtasks: EmbeddedSubtask[]
): string {
  if (subtasks.length === 0) {
    return context;
  }

  const subtaskBlocks = subtasks.map(renderSubtaskBlock).join("\n\n");

  return `${context}\n\n${SUBTASKS_HEADER}\n\n${subtaskBlocks}`;
}

/**
 * Render a single subtask as a <details> block.
 */
function renderSubtaskBlock(subtask: EmbeddedSubtask): string {
  const checkbox = subtask.status === "completed" ? "x" : " ";
  const lines: string[] = [];

  lines.push("<details>");
  lines.push(`<summary>[${checkbox}] ${subtask.description}</summary>`);
  lines.push(`<!-- dex:subtask:id:${subtask.id} -->`);
  lines.push(`<!-- dex:subtask:priority:${subtask.priority} -->`);
  lines.push(`<!-- dex:subtask:status:${subtask.status} -->`);
  lines.push(`<!-- dex:subtask:created_at:${subtask.created_at} -->`);
  lines.push(`<!-- dex:subtask:updated_at:${subtask.updated_at} -->`);
  lines.push(
    `<!-- dex:subtask:completed_at:${subtask.completed_at ?? "null"} -->`
  );
  lines.push("");

  if (subtask.context) {
    lines.push("### Context");
    lines.push(subtask.context);
    lines.push("");
  }

  if (subtask.result) {
    lines.push("### Result");
    lines.push(subtask.result);
    lines.push("");
  }

  lines.push("</details>");

  return lines.join("\n");
}

/**
 * Convert an EmbeddedSubtask to a full Task with parent_id set.
 */
export function embeddedSubtaskToTask(
  subtask: EmbeddedSubtask,
  parentId: string
): Task {
  return { ...subtask, parent_id: parentId };
}

/**
 * Convert a Task to an EmbeddedSubtask for embedding.
 */
export function taskToEmbeddedSubtask(task: Task): EmbeddedSubtask {
  const { parent_id, ...subtask } = task;
  return subtask;
}

/**
 * Calculate the next available subtask index for a parent.
 * @param existingSubtasks - Currently existing subtasks
 * @param parentId - The parent task ID
 * @returns The next available index (1-based)
 */
export function getNextSubtaskIndex(
  existingSubtasks: EmbeddedSubtask[],
  parentId: string
): number {
  let maxIndex = 0;

  for (const subtask of existingSubtasks) {
    const parsed = parseSubtaskId(subtask.id);
    if (parsed && parsed.parentId === parentId) {
      maxIndex = Math.max(maxIndex, parsed.localIndex);
    }
  }

  return maxIndex + 1;
}
