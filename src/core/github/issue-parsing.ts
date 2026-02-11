import type { Task, CommitMetadata } from "../../types.js";

/**
 * Encode a potentially multi-line value for storage in HTML comments.
 * Uses base64 encoding if the value contains newlines or the delimiter characters.
 */
export function encodeMetadataValue(value: string): string {
  // If the value contains newlines, --> (which would break HTML comment), or
  // starts with "base64:" (which is our encoding marker), encode it
  if (
    value.includes("\n") ||
    value.includes("-->") ||
    value.startsWith("base64:")
  ) {
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
 * Safely parse a JSON array, returning empty array on parse failure.
 */
function safeParseJsonArray(value: string): string[] {
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

/**
 * Parse a commit metadata field from a key-value pair.
 * Returns true if the key was a commit field and was processed.
 */
function parseCommitField(
  commit: Partial<CommitMetadata>,
  key: string,
  value: string,
): boolean {
  switch (key) {
    case "commit_sha":
      commit.sha = value;
      return true;
    case "commit_message":
      commit.message = value;
      return true;
    case "commit_branch":
      commit.branch = value;
      return true;
    case "commit_url":
      commit.url = value;
      return true;
    case "commit_timestamp":
      commit.timestamp = value;
      return true;
    default:
      return false;
  }
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
  started_at?: string | null;
  completed_at?: string | null;
  blockedBy?: string[];
  blocks?: string[];
  result?: string | null;
  commit?: CommitMetadata;
  github?: import("../../types.js").GithubMetadata;
}

/**
 * Parse root task metadata from HTML comments in an issue body.
 * Extracts metadata encoded with <!-- dex:task:key:value --> format.
 * @param body - The GitHub issue body
 * @returns Parsed metadata or null if no dex task metadata found
 */
export function parseRootTaskMetadata(
  body: string,
): ParsedRootTaskMetadata | null {
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

    // Try commit fields first
    if (parseCommitField(commit, key, value)) {
      continue;
    }

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
      case "started_at":
        metadata.started_at = value === "null" ? null : value;
        break;
      case "completed_at":
        metadata.completed_at = value === "null" ? null : value;
        break;
      case "blockedBy":
        metadata.blockedBy = safeParseJsonArray(value);
        break;
      case "blocks":
        metadata.blocks = safeParseJsonArray(value);
        break;
      case "result":
        metadata.result = value;
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
  depth: number; // 0 = immediate child of root, 1 = grandchild, etc.
  parentId: string | null;
}

/**
 * Result of parsing an issue body.
 */
export interface ParsedIssueBody {
  description: string;
  subtasks: EmbeddedSubtask[];
}

/**
 * Result of parsing a compound subtask ID.
 */
export interface ParsedSubtaskId {
  parentId: string;
  localIndex: number;
}

// Section headers used for parsing and rendering issue bodies
export const SUBTASKS_HEADER = "## Subtasks";
export const TASKS_HEADER = "## Tasks";
// Legacy headers (kept for parsing old issues)
const LEGACY_TASK_TREE_HEADER = "## Task Tree";
const LEGACY_TASK_DETAILS_HEADER = "## Task Details";

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
 * Result of parsing an issue body with hierarchy info.
 */
export interface ParsedHierarchicalIssueBody {
  description: string;
  subtasks: Array<EmbeddedSubtask & { parentId?: string }>;
}

/** All section headers to look for, in priority order */
const SECTION_HEADERS = [
  TASKS_HEADER,
  SUBTASKS_HEADER,
  LEGACY_TASK_TREE_HEADER,
  LEGACY_TASK_DETAILS_HEADER,
];

/**
 * Find the first section header index in the body.
 * Returns the index and which header was found.
 */
function findFirstSectionHeader(body: string): {
  index: number;
  header: string;
} | null {
  let earliest: { index: number; header: string } | null = null;

  for (const header of SECTION_HEADERS) {
    const index = body.indexOf(header);
    if (index !== -1 && (earliest === null || index < earliest.index)) {
      earliest = { index, header };
    }
  }

  return earliest;
}

/**
 * Extract description and subtasks section start from an issue body.
 * Shared logic for parseIssueBody and parseHierarchicalIssueBody.
 */
function extractBodySections(body: string): {
  description: string;
  subtasksSectionStart: number;
} {
  const firstSection = findFirstSectionHeader(body);

  if (!firstSection) {
    return { description: body.trim(), subtasksSectionStart: -1 };
  }

  const description = body.slice(0, firstSection.index).trim();

  // Find where subtask details begin
  // For current format (## Tasks) or legacy ## Subtasks, details follow the header
  // For old hierarchical format, details are in ## Task Details section
  const isCurrentFormat =
    firstSection.header === TASKS_HEADER ||
    firstSection.header === SUBTASKS_HEADER;

  if (isCurrentFormat) {
    return {
      description,
      subtasksSectionStart: firstSection.index + firstSection.header.length,
    };
  }

  // Legacy hierarchical format - look for Task Details section
  const taskDetailsIndex = body.indexOf(LEGACY_TASK_DETAILS_HEADER);
  if (taskDetailsIndex === -1) {
    return { description, subtasksSectionStart: -1 };
  }

  return {
    description,
    subtasksSectionStart: taskDetailsIndex + LEGACY_TASK_DETAILS_HEADER.length,
  };
}

/**
 * Parse an issue body to extract context and embedded subtasks.
 * Handles multiple formats:
 * - New merged format (## Tasks) with list items containing details
 * - Old hierarchical format (## Task Tree/Details)
 * - Legacy flat format (## Subtasks)
 * @param body - The GitHub issue body
 * @returns Parsed context and subtasks
 */
export function parseIssueBody(body: string): ParsedIssueBody {
  const { description, subtasksSectionStart } = extractBodySections(body);

  if (subtasksSectionStart === -1) {
    return { description, subtasks: [] };
  }

  const subtasks = parseSubtasksSection(body.slice(subtasksSectionStart));
  return { description, subtasks };
}

/**
 * Parse an issue body preserving hierarchy information.
 * Returns subtasks with their parentId for reconstructing the tree.
 * @param body - The GitHub issue body
 * @returns Parsed description and subtasks with parent info
 */
export function parseHierarchicalIssueBody(
  body: string,
): ParsedHierarchicalIssueBody {
  const { description, subtasksSectionStart } = extractBodySections(body);

  if (subtasksSectionStart === -1) {
    return { description, subtasks: [] };
  }

  const parsed = parseSectionWithFormat(body.slice(subtasksSectionStart), true);
  const subtasks = parsed.map(({ subtask, parentId }) => ({
    ...subtask,
    parentId,
  }));

  return { description, subtasks };
}

/**
 * Regex for details blocks
 */
const DETAILS_BLOCK_REGEX = /<details>([\s\S]*?)<\/details>/g;

/**
 * Parse the subtasks section to extract individual subtasks from <details> blocks.
 */
function parseSubtasksSection(section: string): EmbeddedSubtask[] {
  return parseSectionWithFormat(section, false).map(({ subtask }) => subtask);
}

/**
 * Parse a section for subtasks, optionally extracting parent info.
 */
function parseSectionWithFormat(
  section: string,
  extractParent: boolean,
): Array<{ subtask: EmbeddedSubtask; parentId?: string }> {
  const results: Array<{ subtask: EmbeddedSubtask; parentId?: string }> = [];
  const detailsRegex = new RegExp(DETAILS_BLOCK_REGEX.source, "g");
  let match;

  while ((match = detailsRegex.exec(section)) !== null) {
    const detailsContent = match[1];
    const subtask = parseDetailsBlock(detailsContent);
    if (subtask) {
      const parentId = extractParent
        ? extractParentId(detailsContent)
        : undefined;
      results.push({ subtask, parentId });
    }
  }

  return results;
}

/**
 * Extract parent ID from a details block content.
 */
function extractParentId(content: string): string | undefined {
  const match = content.match(/<!-- dex:subtask:parent:(.*?) -->/);
  return match ? match[1] : undefined;
}

/**
 * Parse a single <details> block into a subtask.
 * Handles multiple summary formats:
 * - New format: <summary>✅ └─ <b>Task Name</b></summary> (completed)
 * - In-progress: <summary>🔄 └─ <b>Task Name</b></summary> (in-progress)
 * - Old checkbox format: <summary>[x] Task Name</summary>
 */
function parseDetailsBlock(content: string): EmbeddedSubtask | null {
  // Try new format first: optional status emoji (✅/🔄), optional tree chars, <b>name</b>
  const newFormatMatch = content.match(
    /<summary>\s*((?:✅|🔄)\s*)?(└─\s*)?<b>(.+?)<\/b>\s*<\/summary>/i,
  );
  if (newFormatMatch) {
    const isCompleted = newFormatMatch[1]?.includes("✅") ?? false;
    const name = newFormatMatch[3].trim();
    return parseDetailsBlockWithContext(content, name, isCompleted);
  }

  // Fall back to old checkbox format: [x] or [ ]
  const oldFormatMatch = content.match(
    /<summary>\s*\[([ x])\]\s*(.*?)\s*<\/summary>/i,
  );
  if (oldFormatMatch) {
    const isCompleted = oldFormatMatch[1].toLowerCase() === "x";
    const rawName = oldFormatMatch[2].trim();
    const name = rawName
      .replace(/^↳+\s*/, "") // Remove depth arrows
      .replace(/<\/?b>/g, "") // Remove <b> tags
      .replace(/<code>.*?<\/code>/g, "") // Remove <code>id</code> blocks
      .trim();
    return parseDetailsBlockWithContext(content, name, isCompleted);
  }

  return null;
}

/**
 * Parse a <details> block with name and completion status provided externally.
 * Used for new merged format where name/checkbox are in the list item.
 */
function parseDetailsBlockWithContext(
  content: string,
  name: string,
  isCompleted: boolean,
): EmbeddedSubtask | null {
  // Extract metadata from HTML comments
  const metadata = parseMetadataComments(content);
  if (!metadata.id) {
    return null;
  }

  // Extract description (### Description section, or legacy ### Context section)
  const descriptionMatch = content.match(
    /### (?:Description|Context)\s*\n([\s\S]*?)(?=###|$)/,
  );
  const description = descriptionMatch ? descriptionMatch[1].trim() : "";

  // Extract result (### Result section)
  const resultMatch = content.match(/### Result\s*\n([\s\S]*?)(?=###|$)/);
  const result = resultMatch ? resultMatch[1].trim() : null;

  return {
    id: metadata.id,
    name,
    description,
    priority: metadata.priority ?? 1,
    completed: metadata.completed ?? isCompleted,
    result,
    metadata: metadata.commit ? { commit: metadata.commit } : null,
    created_at: metadata.created_at ?? new Date().toISOString(),
    updated_at: metadata.updated_at ?? new Date().toISOString(),
    started_at: metadata.started_at ?? null,
    completed_at: metadata.completed_at ?? null,
    blockedBy: metadata.blockedBy ?? [],
    blocks: metadata.blocks ?? [],
    children: [],
  };
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
  started_at?: string | null;
  completed_at?: string | null;
  blockedBy?: string[];
  blocks?: string[];
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

    // Try commit fields first
    if (parseCommitField(commit, key, value)) {
      continue;
    }

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
      case "started_at":
        metadata.started_at = rawValue === "null" ? null : value;
        break;
      case "completed_at":
        metadata.completed_at = rawValue === "null" ? null : value;
        break;
      case "blockedBy":
        metadata.blockedBy = safeParseJsonArray(value);
        break;
      case "blocks":
        metadata.blocks = safeParseJsonArray(value);
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
 * Convert an EmbeddedSubtask to a full Task with parent_id set.
 */
export function embeddedSubtaskToTask(
  subtask: EmbeddedSubtask,
  parentId: string,
): Task {
  return { ...subtask, parent_id: parentId };
}

/**
 * Convert a Task to an EmbeddedSubtask for embedding.
 */
export function taskToEmbeddedSubtask(task: Task): EmbeddedSubtask {
  const { parent_id: _, ...subtask } = task;
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
  parentId: string,
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
  rootId: string,
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
