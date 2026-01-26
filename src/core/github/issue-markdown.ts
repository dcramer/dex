import { Task, CommitMetadata, GithubMetadata } from "../../types.js";

/**
 * Encode a potentially multi-line value for storage in HTML comments.
 * Uses base64 encoding if the value contains newlines or the delimiter characters.
 */
export function encodeMetadataValue(value: string): string {
  // If the value contains newlines, --> (which would break HTML comment), or
  // starts with "base64:" (which is our encoding marker), encode it
  if (value.includes("\n") || value.includes("-->") || value.startsWith("base64:")) {
    return `base64:${Buffer.from(value, "utf-8").toString("base64")}`;
  }
  return value;
}

/**
 * Decode a metadata value that may be base64 encoded.
 */
export function decodeMetadataValue(value: string): string {
  if (value.startsWith("base64:")) {
    return Buffer.from(value.slice(7), "base64").toString("utf-8");
  }
  return value;
}

/**
 * Parsed root task metadata from a GitHub issue body.
 */
export interface ParsedRootTaskMetadata {
  id?: string;
  priority?: number;
  completed?: boolean;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
  result?: string | null;
  commit?: CommitMetadata;
  github?: GithubMetadata;
}

/**
 * Parse root task metadata from HTML comments in an issue body.
 * Extracts metadata encoded with <!-- dex:task:key:value --> format.
 * @param body - The GitHub issue body
 * @returns Parsed metadata or null if no dex task metadata found
 */
export function parseRootTaskMetadata(body: string): ParsedRootTaskMetadata | null {
  const metadata: ParsedRootTaskMetadata = {};
  const commit: Partial<CommitMetadata> = {};
  let foundAny = false;

  // Match all dex:task: comments (root task metadata uses dex:task: prefix)
  const commentRegex = /<!-- dex:task:(\w+):(.*?) -->/g;
  let match;

  while ((match = commentRegex.exec(body)) !== null) {
    foundAny = true;
    const [, key, rawValue] = match;
    const value = decodeMetadataValue(rawValue);

    switch (key) {
      case "id":
        metadata.id = value;
        break;
      case "priority":
        metadata.priority = parseInt(value, 10);
        break;
      case "completed":
        metadata.completed = value === "true";
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
      case "result":
        metadata.result = value;
        break;
      case "commit_sha":
        commit.sha = value;
        break;
      case "commit_message":
        commit.message = value;
        break;
      case "commit_branch":
        commit.branch = value;
        break;
      case "commit_url":
        commit.url = value;
        break;
      case "commit_timestamp":
        commit.timestamp = value;
        break;
    }
  }

  if (!foundAny) {
    // Check for legacy format: <!-- dex:task:{id} -->
    const legacyMatch = body.match(/<!-- dex:task:([a-zA-Z0-9]+) -->/);
    if (legacyMatch && !legacyMatch[1].includes(":")) {
      return { id: legacyMatch[1] };
    }
    return null;
  }

  // Only add commit metadata if we have at least a SHA
  if (commit.sha) {
    metadata.commit = commit as CommitMetadata;
  }

  return metadata;
}

/**
 * Represents a subtask parsed from or to be embedded in a GitHub issue body.
 */
export type EmbeddedSubtask = Omit<Task, "parent_id">;

/**
 * A task with hierarchy information for rendering.
 */
export interface HierarchicalTask {
  task: Task;
  depth: number;  // 0 = immediate child of root, 1 = grandchild, etc.
  parentId: string | null;
}

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
const TASK_TREE_HEADER = "## Task Tree";
const TASK_DETAILS_HEADER = "## Task Details";

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
 * Result of parsing an issue body with hierarchy info.
 */
export interface ParsedHierarchicalIssueBody {
  context: string;
  subtasks: Array<EmbeddedSubtask & { parentId?: string }>;
}

/**
 * Parse an issue body to extract context and embedded subtasks.
 * Handles both old flat format (## Subtasks) and new hierarchical format (## Task Tree/Details).
 * @param body - The GitHub issue body
 * @returns Parsed context and subtasks
 */
export function parseIssueBody(body: string): ParsedIssueBody {
  // Check for new hierarchical format
  const taskTreeIndex = body.indexOf(TASK_TREE_HEADER);
  const taskDetailsIndex = body.indexOf(TASK_DETAILS_HEADER);

  if (taskTreeIndex !== -1 || taskDetailsIndex !== -1) {
    // New hierarchical format
    const contextEnd = Math.min(
      taskTreeIndex !== -1 ? taskTreeIndex : Infinity,
      taskDetailsIndex !== -1 ? taskDetailsIndex : Infinity
    );
    const context = body.slice(0, contextEnd).trim();

    // Parse subtasks from Task Details section
    if (taskDetailsIndex !== -1) {
      const detailsSection = body.slice(taskDetailsIndex + TASK_DETAILS_HEADER.length);
      const subtasks = parseSubtasksSection(detailsSection);
      return { context, subtasks };
    }

    return { context, subtasks: [] };
  }

  // Old flat format
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
 * Parse an issue body preserving hierarchy information.
 * Returns subtasks with their parentId for reconstructing the tree.
 * @param body - The GitHub issue body
 * @returns Parsed context and subtasks with parent info
 */
export function parseHierarchicalIssueBody(body: string): ParsedHierarchicalIssueBody {
  const taskTreeIndex = body.indexOf(TASK_TREE_HEADER);
  const taskDetailsIndex = body.indexOf(TASK_DETAILS_HEADER);

  // Determine context end
  const contextEnd = Math.min(
    taskTreeIndex !== -1 ? taskTreeIndex : Infinity,
    taskDetailsIndex !== -1 ? taskDetailsIndex : Infinity,
    body.indexOf(SUBTASKS_HEADER) !== -1 ? body.indexOf(SUBTASKS_HEADER) : Infinity
  );

  const context = contextEnd === Infinity
    ? body.trim()
    : body.slice(0, contextEnd).trim();

  // Parse subtasks with parent info
  const subtasks: Array<EmbeddedSubtask & { parentId?: string }> = [];

  if (taskDetailsIndex !== -1) {
    const detailsSection = body.slice(taskDetailsIndex + TASK_DETAILS_HEADER.length);
    const detailsRegex = /<details>([\s\S]*?)<\/details>/g;
    let match;

    while ((match = detailsRegex.exec(detailsSection)) !== null) {
      const result = parseDetailsBlockWithParent(match[1]);
      if (result) {
        subtasks.push(result);
      }
    }
  } else if (body.indexOf(SUBTASKS_HEADER) !== -1) {
    // Old format - no parent info
    const subtasksSection = body.slice(body.indexOf(SUBTASKS_HEADER) + SUBTASKS_HEADER.length);
    const parsed = parseSubtasksSection(subtasksSection);
    subtasks.push(...parsed);
  }

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
  // Clean up description: remove depth arrows, HTML tags, and code blocks
  const rawDescription = summaryMatch[2].trim();
  const description = rawDescription
    .replace(/^↳+\s*/, "")  // Remove depth arrows
    .replace(/<\/?b>/g, "") // Remove <b> tags
    .replace(/<code>.*?<\/code>/g, "") // Remove <code>id</code> blocks
    .trim();

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
    completed: metadata.completed ?? isCompleted,
    result,
    metadata: metadata.commit ? { commit: metadata.commit } : null,
    created_at: metadata.created_at ?? new Date().toISOString(),
    updated_at: metadata.updated_at ?? new Date().toISOString(),
    completed_at: metadata.completed_at ?? null,
    blockedBy: [],
    blocks: [],
    children: [],
  };
}

/**
 * Parse a single <details> block into a subtask with parent info.
 */
function parseDetailsBlockWithParent(
  content: string
): (EmbeddedSubtask & { parentId?: string }) | null {
  const subtask = parseDetailsBlock(content);
  if (!subtask) return null;

  // Extract parent from metadata
  const parentMatch = content.match(/<!-- dex:subtask:parent:(.*?) -->/);
  const parentId = parentMatch ? parentMatch[1] : undefined;

  return { ...subtask, parentId };
}

/**
 * Parse metadata from HTML comments in a details block.
 */
function parseMetadataComments(content: string): {
  id?: string;
  parent?: string;
  priority?: number;
  completed?: boolean;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
  commit?: CommitMetadata;
} {
  const metadata: ReturnType<typeof parseMetadataComments> = {};
  const commit: Partial<CommitMetadata> = {};

  // Match all dex:subtask: comments
  const commentRegex = /<!-- dex:subtask:(\w+):(.*?) -->/g;
  let match;

  while ((match = commentRegex.exec(content)) !== null) {
    const [, key, rawValue] = match;
    const value = decodeMetadataValue(rawValue);
    switch (key) {
      case "id":
        metadata.id = value;
        break;
      case "parent":
        metadata.parent = value;
        break;
      case "priority":
        metadata.priority = parseInt(value, 10);
        break;
      case "completed":
        metadata.completed = rawValue === "true"; // Use raw value for boolean
        break;
      // Backwards compatibility: read old status field
      case "status":
        if (metadata.completed === undefined) {
          metadata.completed = rawValue === "completed";
        }
        break;
      case "created_at":
        metadata.created_at = value;
        break;
      case "updated_at":
        metadata.updated_at = value;
        break;
      case "completed_at":
        metadata.completed_at = rawValue === "null" ? null : value;
        break;
      case "commit_sha":
        commit.sha = value;
        break;
      case "commit_message":
        commit.message = value;
        break;
      case "commit_branch":
        commit.branch = value;
        break;
      case "commit_url":
        commit.url = value;
        break;
      case "commit_timestamp":
        commit.timestamp = value;
        break;
    }
  }

  // Only add commit metadata if we have at least a SHA
  if (commit.sha) {
    metadata.commit = commit as CommitMetadata;
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
 * Render commit metadata as HTML comment lines.
 * Returns an array of comment lines to be added to a details block.
 */
function renderCommitMetadataComments(commit: CommitMetadata): string[] {
  const lines: string[] = [`<!-- dex:subtask:commit_sha:${commit.sha} -->`];
  if (commit.message) {
    lines.push(`<!-- dex:subtask:commit_message:${encodeMetadataValue(commit.message)} -->`);
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
  return lines;
}

/**
 * Render a single subtask as a <details> block.
 */
function renderSubtaskBlock(subtask: EmbeddedSubtask): string {
  const checkbox = subtask.completed ? "x" : " ";
  const lines: string[] = [];

  lines.push("<details>");
  lines.push(`<summary>[${checkbox}] ${subtask.description}</summary>`);
  lines.push(`<!-- dex:subtask:id:${subtask.id} -->`);
  lines.push(`<!-- dex:subtask:priority:${subtask.priority} -->`);
  lines.push(`<!-- dex:subtask:completed:${subtask.completed} -->`);
  lines.push(`<!-- dex:subtask:created_at:${subtask.created_at} -->`);
  lines.push(`<!-- dex:subtask:updated_at:${subtask.updated_at} -->`);
  lines.push(
    `<!-- dex:subtask:completed_at:${subtask.completed_at ?? "null"} -->`
  );

  if (subtask.metadata?.commit) {
    lines.push(...renderCommitMetadataComments(subtask.metadata.commit));
  }

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

/**
 * Collect all descendants of a task in depth-first order with hierarchy info.
 * @param allTasks - All tasks in the store
 * @param rootId - The root task ID to collect descendants from
 * @returns Array of tasks with depth information
 */
export function collectDescendants(
  allTasks: Task[],
  rootId: string
): HierarchicalTask[] {
  const result: HierarchicalTask[] = [];

  function collect(parentId: string, depth: number): void {
    const children = allTasks
      .filter((t) => t.parent_id === parentId)
      .sort((a, b) => a.priority - b.priority);

    for (const child of children) {
      result.push({ task: child, depth, parentId });
      collect(child.id, depth + 1);
    }
  }

  collect(rootId, 0);
  return result;
}

/**
 * Render an issue body with hierarchical task tree and details.
 * @param context - The root task context
 * @param descendants - All descendant tasks with hierarchy info
 * @returns The rendered markdown body
 */
export function renderHierarchicalIssueBody(
  context: string,
  descendants: HierarchicalTask[]
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
    lines.push(`${indent}- [${checkbox}] **${task.description}** \`${task.id}\``);
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
  parentId: string | null
): string {
  const checkbox = task.completed ? "x" : " ";
  const depthArrow = depth > 0 ? "↳".repeat(depth) + " " : "";
  const lines: string[] = [];

  lines.push("<details>");
  lines.push(
    `<summary>[${checkbox}] ${depthArrow}<b>${task.description}</b> <code>${task.id}</code></summary>`
  );
  lines.push(`<!-- dex:subtask:id:${task.id} -->`);
  if (parentId) {
    lines.push(`<!-- dex:subtask:parent:${parentId} -->`);
  }
  lines.push(`<!-- dex:subtask:priority:${task.priority} -->`);
  lines.push(`<!-- dex:subtask:completed:${task.completed} -->`);
  lines.push(`<!-- dex:subtask:created_at:${task.created_at} -->`);
  lines.push(`<!-- dex:subtask:updated_at:${task.updated_at} -->`);
  lines.push(
    `<!-- dex:subtask:completed_at:${task.completed_at ?? "null"} -->`
  );

  if (task.metadata?.commit) {
    lines.push(...renderCommitMetadataComments(task.metadata.commit));
  }

  lines.push("");

  if (task.context) {
    lines.push("### Context");
    lines.push(task.context);
    lines.push("");
  }

  if (task.result) {
    lines.push("### Result");
    lines.push(task.result);
    lines.push("");
  }

  lines.push("</details>");

  return lines.join("\n");
}
