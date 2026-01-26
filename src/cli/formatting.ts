import { Task } from "../types.js";
import { colors, stripAnsi } from "./colors.js";

export interface FormatTaskOptions {
  verbose?: boolean;
  treePrefix?: string;
  truncateDescription?: number;
  blockedByIds?: string[]; // IDs of incomplete tasks blocking this one
}

export function formatAge(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Format a breadcrumb path from ancestors to current task.
 * Example: "Epic > Task > Subtask"
 */
export function formatBreadcrumb(
  ancestors: Task[],
  current: Task,
  maxDescLength: number = 30,
): string {
  const items = [...ancestors, current].map((t) =>
    truncateText(t.description, maxDescLength),
  );
  return items.join(` ${colors.dim}>${colors.reset} `);
}

/**
 * Wrap text to fit within a specified width, with proper indentation for continuation lines.
 * Handles ANSI color codes correctly by not counting them toward line length.
 */
export function wrapText(
  text: string,
  width: number,
  indent: string = "",
): string {
  if (!text) return "";

  const effectiveWidth = width - indent.length;
  if (effectiveWidth <= 10) {
    return indent + text;
  }

  const lines: string[] = [];
  const paragraphs = text.split(/\n/);

  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push("");
      continue;
    }

    const words = paragraph.split(/\s+/);
    let currentLine = "";
    let currentVisibleLength = 0;

    for (const word of words) {
      if (!word) continue;

      const wordVisibleLength = stripAnsi(word).length;
      const needsSpace = currentLine.length > 0;
      const spaceLength = needsSpace ? 1 : 0;

      const fitsOnCurrentLine =
        currentVisibleLength + spaceLength + wordVisibleLength <=
        effectiveWidth;

      if (fitsOnCurrentLine) {
        currentLine += (needsSpace ? " " : "") + word;
        currentVisibleLength += spaceLength + wordVisibleLength;
      } else {
        if (currentLine) {
          lines.push(currentLine);
        }

        if (wordVisibleLength > effectiveWidth) {
          lines.push(word);
          currentLine = "";
          currentVisibleLength = 0;
        } else {
          currentLine = word;
          currentVisibleLength = wordVisibleLength;
        }
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return lines.map((line) => indent + line).join("\n");
}

/**
 * Truncate text to a maximum length, adding ellipsis if truncated.
 */
export function truncateText(text: string, maxLength: number): string {
  if (!text) return "";
  const visibleLength = stripAnsi(text).length;
  if (visibleLength <= maxLength) return text;
  if (maxLength <= 3) return "...";
  return text.slice(0, maxLength - 3) + "...";
}

export function formatTask(
  task: Task,
  options: FormatTaskOptions = {},
): string {
  const {
    verbose = false,
    treePrefix = "",
    truncateDescription,
    blockedByIds,
  } = options;

  const statusIcon = task.completed ? "[x]" : "[ ]";
  const statusColor = task.completed ? colors.green : colors.yellow;
  const priority =
    task.priority !== 1
      ? ` ${colors.cyan}[p${task.priority}]${colors.reset}`
      : "";
  const completionAge =
    task.completed && task.completed_at
      ? ` ${colors.dim}(${formatAge(task.completed_at)})${colors.reset}`
      : "";

  // Show blocked indicator if task has incomplete blockers
  let blockedIndicator = "";
  if (blockedByIds && blockedByIds.length > 0) {
    const blockedInfo =
      blockedByIds.length === 1 ? blockedByIds[0] : blockedByIds.length;
    blockedIndicator = ` ${colors.red}[B: ${blockedInfo}]${colors.reset}`;
  }

  const description = truncateDescription
    ? truncateText(task.description, truncateDescription)
    : task.description;

  let output = `${treePrefix}${statusColor}${statusIcon}${colors.reset} ${colors.bold}${task.id}${colors.reset}${priority}${blockedIndicator}: ${description}${completionAge}`;

  if (verbose) {
    const labelWidth = 12;
    // For verbose output, create a continuation prefix that aligns with the tree
    const verbosePrefix = treePrefix
      .replace(/├── $/, "│   ")
      .replace(/└── $/, "    ");
    output += `\n${verbosePrefix}  ${"Context:".padEnd(labelWidth)} ${task.context}`;
    if (task.result) {
      output += `\n${verbosePrefix}  ${"Result:".padEnd(labelWidth)} ${colors.green}${task.result}${colors.reset}`;
    }
    if (task.metadata?.commit) {
      output += `\n${verbosePrefix}  ${"Commit:".padEnd(labelWidth)} ${colors.cyan}${task.metadata.commit.sha}${colors.reset}`;
    }
    output += `\n${verbosePrefix}  ${"Created:".padEnd(labelWidth)} ${colors.dim}${task.created_at}${colors.reset}`;
    output += `\n${verbosePrefix}  ${"Updated:".padEnd(labelWidth)} ${colors.dim}${task.updated_at}${colors.reset}`;
    if (task.completed_at) {
      output += `\n${verbosePrefix}  ${"Completed:".padEnd(labelWidth)} ${colors.dim}${task.completed_at}${colors.reset}`;
    }
  }

  return output;
}

/**
 * Simple pluralization helper.
 */
export function pluralize(
  count: number,
  singular: string,
  plural?: string,
): string {
  return count === 1 ? singular : (plural ?? singular + "s");
}
