import { Task, TaskStatus } from "../types.js";

/**
 * Subtask data extracted from or to be embedded in parent issue body.
 */
export interface EmbeddedSubtask {
  id: string;
  description: string;
  context: string;
  priority: number;
  status: TaskStatus;
  result: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

/**
 * Parsed issue body containing parent context and embedded subtasks.
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

/**
 * Parse a compound subtask ID (e.g., "9-1" → { parentId: "9", localIndex: 1 })
 * Returns null if the ID is not a valid compound format.
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
 * Create a compound subtask ID from parent ID and local index.
 */
export function createSubtaskId(parentId: string, index: number): string {
  return `${parentId}-${index}`;
}

/**
 * Parse a subtask's metadata from HTML comment markers.
 */
function parseSubtaskMetadata(content: string): Partial<EmbeddedSubtask> {
  const metadata: Partial<EmbeddedSubtask> = {};

  const idMatch = content.match(/<!-- dex:subtask:id:([^\s]+) -->/);
  if (idMatch) metadata.id = idMatch[1];

  const priorityMatch = content.match(/<!-- dex:subtask:priority:(\d+) -->/);
  if (priorityMatch) metadata.priority = parseInt(priorityMatch[1], 10);

  const statusMatch = content.match(/<!-- dex:subtask:status:(pending|completed) -->/);
  if (statusMatch) metadata.status = statusMatch[1] as TaskStatus;

  const createdAtMatch = content.match(/<!-- dex:subtask:created_at:([^\s]+) -->/);
  if (createdAtMatch) metadata.created_at = createdAtMatch[1];

  const updatedAtMatch = content.match(/<!-- dex:subtask:updated_at:([^\s]+) -->/);
  if (updatedAtMatch) metadata.updated_at = updatedAtMatch[1];

  const completedAtMatch = content.match(/<!-- dex:subtask:completed_at:([^\s]+) -->/);
  if (completedAtMatch) metadata.completed_at = completedAtMatch[1];

  return metadata;
}

/**
 * Parse the issue body to extract parent context and embedded subtasks.
 */
export function parseIssueBody(body: string | null): ParsedIssueBody {
  if (!body) {
    return { context: "", subtasks: [] };
  }

  // Find the ## Subtasks section
  const subtasksSectionMatch = body.match(/\n## Subtasks\s*\n/);
  if (!subtasksSectionMatch) {
    // No subtasks section, entire body is context
    return { context: body.trim(), subtasks: [] };
  }

  const subtasksSectionIndex = subtasksSectionMatch.index!;
  const context = body.slice(0, subtasksSectionIndex).trim();
  const subtasksSection = body.slice(subtasksSectionIndex + subtasksSectionMatch[0].length);

  // Parse individual subtasks from <details> blocks
  const subtasks: EmbeddedSubtask[] = [];
  const detailsRegex = /<details>\s*<summary>\[([ x])\]\s*(.+?)<\/summary>([\s\S]*?)<\/details>/g;

  let match;
  while ((match = detailsRegex.exec(subtasksSection)) !== null) {
    const isCompleted = match[1] === "x";
    const description = match[2].trim();
    const detailsContent = match[3];

    // Parse metadata from comments
    const metadata = parseSubtaskMetadata(detailsContent);

    // Extract context (content after metadata, before ### Result if present)
    let subtaskContext = "";
    let subtaskResult: string | null = null;

    // Find ### Context section
    const contextMatch = detailsContent.match(/### Context\s*\n([\s\S]*?)(?=\n### |$)/);
    if (contextMatch) {
      subtaskContext = contextMatch[1].trim();
    }

    // Find ### Result section
    const resultMatch = detailsContent.match(/### Result\s*\n([\s\S]*?)$/);
    if (resultMatch) {
      subtaskResult = resultMatch[1].trim();
    }

    // Use metadata values or derive from parsed content
    const subtask: EmbeddedSubtask = {
      id: metadata.id || "",
      description,
      context: subtaskContext,
      priority: metadata.priority ?? 1,
      status: metadata.status ?? (isCompleted ? "completed" : "pending"),
      result: subtaskResult,
      created_at: metadata.created_at || new Date().toISOString(),
      updated_at: metadata.updated_at || new Date().toISOString(),
      completed_at: metadata.completed_at || (isCompleted ? new Date().toISOString() : null),
    };

    subtasks.push(subtask);
  }

  return { context, subtasks };
}

/**
 * Render metadata comments for a subtask.
 */
function renderSubtaskMetadata(subtask: EmbeddedSubtask): string {
  const lines = [
    `<!-- dex:subtask:id:${subtask.id} -->`,
    `<!-- dex:subtask:priority:${subtask.priority} -->`,
    `<!-- dex:subtask:status:${subtask.status} -->`,
    `<!-- dex:subtask:created_at:${subtask.created_at} -->`,
    `<!-- dex:subtask:updated_at:${subtask.updated_at} -->`,
  ];

  if (subtask.completed_at) {
    lines.push(`<!-- dex:subtask:completed_at:${subtask.completed_at} -->`);
  }

  return lines.join("\n");
}

/**
 * Render a single subtask as a collapsible <details> block.
 */
function renderSubtask(subtask: EmbeddedSubtask): string {
  const checkbox = subtask.status === "completed" ? "[x]" : "[ ]";
  const lines = [
    "<details>",
    `<summary>${checkbox} ${subtask.description}</summary>`,
    renderSubtaskMetadata(subtask),
    "",
    "### Context",
    subtask.context || "(No context provided)",
  ];

  if (subtask.result) {
    lines.push("", "### Result", subtask.result);
  }

  lines.push("", "</details>");

  return lines.join("\n");
}

/**
 * Render the complete issue body with parent context and embedded subtasks.
 */
export function renderIssueBody(context: string, subtasks: EmbeddedSubtask[]): string {
  if (subtasks.length === 0) {
    return context;
  }

  const lines = [context, "", "## Subtasks", ""];

  for (const subtask of subtasks) {
    lines.push(renderSubtask(subtask));
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

/**
 * Convert a Task to an EmbeddedSubtask format.
 */
export function taskToEmbeddedSubtask(task: Task): EmbeddedSubtask {
  return {
    id: task.id,
    description: task.description,
    context: task.context,
    priority: task.priority,
    status: task.status,
    result: task.result,
    created_at: task.created_at,
    updated_at: task.updated_at,
    completed_at: task.completed_at,
  };
}

/**
 * Convert an EmbeddedSubtask to a Task format, adding parent_id.
 */
export function embeddedSubtaskToTask(subtask: EmbeddedSubtask, parentId: string): Task {
  return {
    id: subtask.id,
    parent_id: parentId,
    description: subtask.description,
    context: subtask.context,
    priority: subtask.priority,
    status: subtask.status,
    result: subtask.result,
    created_at: subtask.created_at,
    updated_at: subtask.updated_at,
    completed_at: subtask.completed_at,
  };
}

/**
 * Get the next available local index for a subtask in the given parent.
 */
export function getNextSubtaskIndex(existingSubtasks: EmbeddedSubtask[]): number {
  if (existingSubtasks.length === 0) {
    return 1;
  }

  const indices = existingSubtasks
    .map((s) => parseSubtaskId(s.id))
    .filter((parsed): parsed is ParsedSubtaskId => parsed !== null)
    .map((parsed) => parsed.localIndex);

  if (indices.length === 0) {
    return 1;
  }

  return Math.max(...indices) + 1;
}
