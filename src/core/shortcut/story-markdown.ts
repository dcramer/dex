import type { Task, CommitMetadata, ShortcutMetadata } from "../../types.js";

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
 * Parsed task metadata from a Shortcut story description.
 */
export interface ParsedTaskMetadata {
  id?: string;
  priority?: number;
  completed?: boolean;
  created_at?: string;
  updated_at?: string;
  completed_at?: string | null;
  result?: string | null;
  commit?: CommitMetadata;
  shortcut?: ShortcutMetadata;
  parent_id?: string;
}

/**
 * Parse task metadata from HTML comments in a story description.
 * Extracts metadata encoded with <!-- dex:task:key:value --> format.
 * @param description - The Shortcut story description
 * @returns Parsed metadata or null if no dex task metadata found
 */
export function parseTaskMetadata(
  description: string,
): ParsedTaskMetadata | null {
  const metadata: ParsedTaskMetadata = {};
  const commit: Partial<CommitMetadata> = {};
  let foundAny = false;

  // Match all dex:task: comments (root task metadata uses dex:task: prefix)
  const commentRegex = /<!-- dex:task:(\w+):(.*?) -->/g;
  let match;

  while ((match = commentRegex.exec(description)) !== null) {
    foundAny = true;
    const [, key, rawValue] = match;
    const value = decodeMetadataValue(rawValue);

    switch (key) {
      case "id":
        metadata.id = value;
        break;
      case "parent_id":
        metadata.parent_id = value;
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
    return null;
  }

  // Only add commit metadata if we have at least a SHA
  if (commit.sha) {
    metadata.commit = commit as CommitMetadata;
  }

  return metadata;
}

/**
 * Result of parsing a story description.
 */
export interface ParsedStoryDescription {
  context: string;
  metadata: ParsedTaskMetadata | null;
}

/**
 * Parse a story description to extract context and metadata.
 * @param description - The Shortcut story description
 * @returns Parsed context and metadata
 */
export function parseStoryDescription(
  description: string,
): ParsedStoryDescription {
  const metadata = parseTaskMetadata(description);

  // Remove all dex:task: comments to get clean context
  const cleanContext = description
    .replace(/<!-- dex:task:[^\s]+ -->\n?/g, "")
    .trim();

  return { context: cleanContext, metadata };
}

/**
 * Render a story description with embedded task metadata.
 * @param task - The task to render
 * @returns The rendered story description
 */
export function renderStoryDescription(task: Task): string {
  const lines: string[] = [];

  // Add metadata comments
  lines.push(`<!-- dex:task:id:${task.id} -->`);
  if (task.parent_id) {
    lines.push(`<!-- dex:task:parent_id:${task.parent_id} -->`);
  }
  lines.push(`<!-- dex:task:priority:${task.priority} -->`);
  lines.push(`<!-- dex:task:completed:${task.completed} -->`);
  lines.push(`<!-- dex:task:created_at:${task.created_at} -->`);
  lines.push(`<!-- dex:task:updated_at:${task.updated_at} -->`);
  lines.push(`<!-- dex:task:completed_at:${task.completed_at ?? "null"} -->`);

  // Add result if present (base64 encoded for multi-line support)
  if (task.result) {
    lines.push(`<!-- dex:task:result:${encodeMetadataValue(task.result)} -->`);
  }

  // Add commit metadata if present
  if (task.metadata?.commit) {
    const commit = task.metadata.commit;
    lines.push(`<!-- dex:task:commit_sha:${commit.sha} -->`);
    if (commit.message) {
      lines.push(
        `<!-- dex:task:commit_message:${encodeMetadataValue(commit.message)} -->`,
      );
    }
    if (commit.branch) {
      lines.push(`<!-- dex:task:commit_branch:${commit.branch} -->`);
    }
    if (commit.url) {
      lines.push(`<!-- dex:task:commit_url:${commit.url} -->`);
    }
    if (commit.timestamp) {
      lines.push(`<!-- dex:task:commit_timestamp:${commit.timestamp} -->`);
    }
  }

  // Add task description
  if (task.description) {
    lines.push("");
    lines.push(task.description);
  }

  return lines.join("\n");
}
