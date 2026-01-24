import { Task } from "../types.js";
import {
  CliOptions,
  colors,
  createService,
  exitIfTaskNotFound,
  formatAge,
  getBooleanFlag,
  parseArgs,
  pluralize,
  stripAnsi,
  terminalWidth,
  truncateText,
  wrapText,
} from "./utils.js";

// Max description length for tree display
const SHOW_TREE_DESCRIPTION_MAX_LENGTH = 50;
// Max characters before truncation for context/result fields
const SHOW_TEXT_MAX_LENGTH = 300;

interface FormatTaskShowOptions {
  ancestors?: Task[];
  children?: Task[];
  grandchildren?: Task[];
  full?: boolean;
  blockedByTasks?: Task[];  // Tasks that block this one
  blocksTasks?: Task[];     // Tasks this one blocks
}

/**
 * Truncate text if needed and report whether truncation occurred.
 * Returns the (possibly truncated) text and a boolean indicating if it was truncated.
 */
function truncateIfNeeded(text: string, maxLength: number): { text: string; truncated: boolean } {
  const visibleLength = stripAnsi(text).length;
  if (visibleLength <= maxLength) {
    return { text, truncated: false };
  }
  return { text: truncateText(text, maxLength), truncated: true };
}

/**
 * Format a task line for the hierarchy tree.
 */
function formatTreeTask(task: Task, options: {
  prefix?: string;
  isCurrent?: boolean;
  truncateDescription?: number;
  childCount?: number;
}): string {
  const { prefix = "", isCurrent = false, truncateDescription = SHOW_TREE_DESCRIPTION_MAX_LENGTH, childCount } = options;
  const statusIcon = task.completed ? "[x]" : "[ ]";
  const statusColor = task.completed ? colors.green : colors.yellow;
  const desc = truncateText(task.description, truncateDescription);
  const childInfo = childCount !== undefined && childCount > 0
    ? ` ${colors.dim}(${childCount} ${pluralize(childCount, "subtask")})${colors.reset}`
    : "";

  if (isCurrent) {
    return `${prefix}${statusColor}${statusIcon}${colors.reset} ${colors.bold}${task.id}${colors.reset}: ${desc}${childInfo}  ${colors.cyan}← viewing${colors.reset}`;
  }
  return `${prefix}${statusColor}${statusIcon}${colors.reset} ${colors.dim}${task.id}${colors.reset}: ${desc}${childInfo}`;
}

/**
 * Format the hierarchy tree showing ancestors, current task, and children.
 */
function formatHierarchyTree(task: Task, ancestors: Task[], children: Task[], grandchildren: Task[]): string[] {
  const lines: string[] = [];

  // Build the tree from root to current task
  // Each ancestor gets progressively deeper indentation
  let currentIndent = "";

  for (let i = 0; i < ancestors.length; i++) {
    const ancestor = ancestors[i];
    const isLast = i === ancestors.length - 1;

    // Count children for this ancestor (next ancestor or current task if last)
    const nextId = isLast ? task.id : ancestors[i + 1].id;
    // We don't have sibling info, so just show the line
    const connector = i === 0 ? "" : "└── ";
    lines.push(formatTreeTask(ancestor, { prefix: currentIndent + connector }));

    // Update indent for next level
    if (i === 0) {
      currentIndent = "";
    } else {
      currentIndent += "    ";
    }
  }

  // Current task - highlighted
  const currentConnector = ancestors.length > 0 ? "└── " : "";
  const currentPrefix = currentIndent + currentConnector;
  lines.push(formatTreeTask(task, {
    prefix: currentPrefix,
    isCurrent: true,
    childCount: children.length,
  }));

  // Children of current task
  if (children.length > 0) {
    const childIndent = ancestors.length > 0 ? currentIndent + "    " : "";

    // Sort by priority then completion status (pending first)
    const sortedChildren = [...children].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      return 0;
    });

    for (let i = 0; i < sortedChildren.length; i++) {
      const child = sortedChildren[i];
      const isLast = i === sortedChildren.length - 1;
      const connector = isLast ? "└── " : "├── ";
      const childGrandchildren = grandchildren.filter((g) => g.parent_id === child.id);
      lines.push(formatTreeTask(child, {
        prefix: childIndent + connector,
        childCount: childGrandchildren.length,
      }));
    }
  }

  return lines;
}

/**
 * Format the detailed show view for a task with proper text wrapping.
 */
export function formatTaskShow(task: Task, options: FormatTaskShowOptions = {}): string {
  const { ancestors = [], children = [], grandchildren = [], full = false, blockedByTasks = [], blocksTasks = [] } = options;
  let wasTruncated = false;
  const priority = task.priority !== 1 ? ` ${colors.cyan}[p${task.priority}]${colors.reset}` : "";

  const lines: string[] = [];

  // Hierarchy tree (if this task has ancestors or children)
  if (ancestors.length > 0 || children.length > 0) {
    lines.push(...formatHierarchyTree(task, ancestors, children, grandchildren));
    lines.push(""); // Blank line after tree
  } else {
    // No hierarchy - just show the task header
    const statusIcon = task.completed ? "[x]" : "[ ]";
    const statusColor = task.completed ? colors.green : colors.yellow;
    lines.push(`${statusColor}${statusIcon}${colors.reset} ${colors.bold}${task.id}${colors.reset}${priority}: ${task.description}`);
    lines.push(""); // Blank line after header
  }

  // Blocked by section (incomplete blockers)
  const incompleteBlockers = blockedByTasks.filter((t) => !t.completed);
  if (incompleteBlockers.length > 0) {
    lines.push(`${colors.bold}${colors.red}Blocked by:${colors.reset}`);
    for (const blocker of incompleteBlockers) {
      lines.push(`  ${colors.dim}•${colors.reset} ${colors.bold}${blocker.id}${colors.reset}: ${truncateText(blocker.description, 50)}`);
    }
    lines.push(""); // Blank line after
  }

  // Blocks section (tasks this one blocks that are not completed)
  const incompleteBlocked = blocksTasks.filter((t) => !t.completed);
  if (incompleteBlocked.length > 0) {
    lines.push(`${colors.bold}Blocks:${colors.reset}`);
    for (const blocked of incompleteBlocked) {
      lines.push(`  ${colors.dim}•${colors.reset} ${colors.bold}${blocked.id}${colors.reset}: ${truncateText(blocked.description, 50)}`);
    }
    lines.push(""); // Blank line after
  }

  // Context section with word wrapping
  const indent = "  ";
  lines.push(`${colors.bold}Context:${colors.reset}`);
  const context = full ? { text: task.context, truncated: false } : truncateIfNeeded(task.context, SHOW_TEXT_MAX_LENGTH);
  wasTruncated ||= context.truncated;
  lines.push(wrapText(context.text, terminalWidth, indent));

  // Result section (if present) with word wrapping
  if (task.result) {
    lines.push(""); // Blank line before result
    lines.push(`${colors.bold}Result:${colors.reset}`);
    const result = full ? { text: task.result, truncated: false } : truncateIfNeeded(task.result, SHOW_TEXT_MAX_LENGTH);
    wasTruncated ||= result.truncated;
    lines.push(wrapText(`${colors.green}${result.text}${colors.reset}`, terminalWidth, indent));
  }

  // Commit metadata section (if present)
  if (task.metadata?.commit) {
    const commit = task.metadata.commit;
    lines.push(""); // Blank line before commit section
    lines.push(`${colors.bold}Commit:${colors.reset}`);
    lines.push(`  SHA:    ${colors.cyan}${commit.sha}${colors.reset}`);
    if (commit.message) {
      lines.push(`  Message: ${commit.message}`);
    }
    if (commit.branch) {
      lines.push(`  Branch:  ${commit.branch}`);
    }
    if (commit.url) {
      lines.push(`  URL:     ${colors.dim}${commit.url}${colors.reset}`);
    }
  }

  // Metadata section
  lines.push(""); // Blank line before metadata
  const labelWidth = 10;
  lines.push(`${"Created:".padEnd(labelWidth)} ${colors.dim}${task.created_at}${colors.reset}`);
  lines.push(`${"Updated:".padEnd(labelWidth)} ${colors.dim}${task.updated_at}${colors.reset}`);
  if (task.completed_at) {
    lines.push(`${"Completed:".padEnd(labelWidth)} ${colors.dim}${task.completed_at}${colors.reset}`);
  }

  // More Information section (navigation hints)
  const parentTask = ancestors.length > 0 ? ancestors[ancestors.length - 1] : null;
  if (parentTask || children.length > 0 || wasTruncated) {
    lines.push("");
    lines.push(`${colors.bold}More Information:${colors.reset}`);

    if (parentTask) {
      lines.push(`  ${colors.dim}•${colors.reset} View parent task: ${colors.cyan}dex show ${parentTask.id}${colors.reset}`);
    }
    if (children.length > 0) {
      lines.push(`  ${colors.dim}•${colors.reset} View subtree: ${colors.cyan}dex list ${task.id}${colors.reset}`);
    }
    if (wasTruncated) {
      lines.push(`  ${colors.dim}•${colors.reset} View full content: ${colors.cyan}dex show ${task.id} --full${colors.reset}`);
    }
  }

  return lines.join("\n");
}

export async function showCommand(args: string[], options: CliOptions): Promise<void> {
  const { positional, flags } = parseArgs(args, {
    json: { hasValue: false },
    full: { short: "f", hasValue: false },
    help: { short: "h", hasValue: false },
  }, "show");

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex show${colors.reset} - Show task details

${colors.bold}USAGE:${colors.reset}
  dex show <task-id> [options]

${colors.bold}ARGUMENTS:${colors.reset}
  <task-id>                  Task ID to display (required)

${colors.bold}OPTIONS:${colors.reset}
  -f, --full                 Show full context and result (no truncation)
  --json                     Output as JSON
  -h, --help                 Show this help message

${colors.bold}EXAMPLE:${colors.reset}
  dex show abc123            # Show task details
  dex show abc123 --json     # Output as JSON for scripting
`);
    return;
  }

  const id = positional[0];

  if (!id) {
    console.error(`${colors.red}Error:${colors.reset} Task ID is required`);
    console.error(`Usage: dex show <task-id>`);
    process.exit(1);
  }

  const service = createService(options);
  const task = await exitIfTaskNotFound(await service.get(id), id, service);

  const children = await service.getChildren(id);
  const ancestors = await service.getAncestors(id);

  // Collect grandchildren (children of children)
  const grandchildren: Task[] = [];
  for (const child of children) {
    const childChildren = await service.getChildren(child.id);
    grandchildren.push(...childChildren);
  }

  // Get blocking relationship info
  const blockedByTasks = await service.getIncompleteBlockers(id);
  const blocksTasks = await service.getBlockedTasks(id);

  // JSON output mode
  if (getBooleanFlag(flags, "json")) {
    const pending = children.filter((c) => !c.completed);
    const pendingGrandchildren = grandchildren.filter((c) => !c.completed);
    const jsonOutput = {
      ...task,
      ancestors: ancestors.map((a) => ({ id: a.id, description: a.description })),
      depth: ancestors.length,
      subtasks: {
        pending: pending.length,
        completed: children.length - pending.length,
        children,
      },
      grandchildren: grandchildren.length > 0 ? {
        pending: pendingGrandchildren.length,
        completed: grandchildren.length - pendingGrandchildren.length,
        tasks: grandchildren,
      } : null,
      blockedBy: blockedByTasks.map((t) => ({ id: t.id, description: t.description, completed: t.completed })),
      blocks: blocksTasks.map((t) => ({ id: t.id, description: t.description, completed: t.completed })),
      isBlocked: blockedByTasks.some((t) => !t.completed),
    };
    console.log(JSON.stringify(jsonOutput, null, 2));
    return;
  }

  const full = getBooleanFlag(flags, "full");
  console.log(formatTaskShow(task, { ancestors, children, grandchildren, full, blockedByTasks, blocksTasks }));
}
