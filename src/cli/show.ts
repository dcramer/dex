import { ArchivedTask, GithubMetadata, Task } from "../types.js";
import { CliOptions, createService, exitIfTaskNotFound } from "./utils.js";
import { colors, stripAnsi, terminalWidth } from "./colors.js";
import { getBooleanFlag, parseArgs } from "./args.js";
import { pluralize, truncateText, wrapText } from "./formatting.js";
import { isArchivedTask } from "../core/task-service.js";

// Max name length for tree display
const SHOW_TREE_NAME_MAX_LENGTH = 50;
// Max characters before truncation for description/result fields
const SHOW_TEXT_MAX_LENGTH = 300;

interface FormatTaskShowOptions {
  ancestors?: Task[];
  children?: Task[];
  grandchildren?: Task[];
  full?: boolean;
  expand?: boolean; // Show descriptions for ancestor tasks in tree
  blockedByTasks?: Task[]; // Tasks that block this one
  blocksTasks?: Task[]; // Tasks this one blocks
  ancestorGithub?: GithubMetadata; // GitHub metadata from first ancestor that has it
}

/**
 * Truncate text if needed and report whether truncation occurred.
 * Returns the (possibly truncated) text and a boolean indicating if it was truncated.
 */
function truncateIfNeeded(
  text: string,
  maxLength: number,
): { text: string; truncated: boolean } {
  const visibleLength = stripAnsi(text).length;
  if (visibleLength <= maxLength) {
    return { text, truncated: false };
  }
  return { text: truncateText(text, maxLength), truncated: true };
}

/**
 * Format a task line for the hierarchy tree.
 */
function formatTreeTask(
  task: Task,
  options: {
    prefix?: string;
    isCurrent?: boolean;
    truncateName?: number;
    childCount?: number;
  },
): string {
  const {
    prefix = "",
    isCurrent = false,
    truncateName = SHOW_TREE_NAME_MAX_LENGTH,
    childCount,
  } = options;
  const statusIcon = task.completed ? "[x]" : "[ ]";
  const statusColor = task.completed ? colors.green : colors.yellow;
  const name = truncateText(task.name, truncateName);
  const childInfo =
    childCount !== undefined && childCount > 0
      ? ` ${colors.dim}(${childCount} ${pluralize(childCount, "subtask")})${colors.reset}`
      : "";

  if (isCurrent) {
    return `${prefix}${statusColor}${statusIcon}${colors.reset} ${colors.bold}${task.id}${colors.reset}: ${name}${childInfo}  ${colors.cyan}← viewing${colors.reset}`;
  }
  return `${prefix}${statusColor}${statusIcon}${colors.reset} ${colors.dim}${task.id}${colors.reset}: ${name}${childInfo}`;
}

/**
 * Format the hierarchy tree showing ancestors, current task, and children.
 */
function formatHierarchyTree(
  task: Task,
  ancestors: Task[],
  children: Task[],
  grandchildren: Task[],
  options: { expand?: boolean } = {},
): string[] {
  const { expand = false } = options;
  const lines: string[] = [];

  // Build the tree from root to current task
  // Each ancestor gets progressively deeper indentation
  for (let i = 0; i < ancestors.length; i++) {
    const ancestor = ancestors[i];
    const isFirst = i === 0;
    const indent = isFirst ? "" : "    ".repeat(i - 1);
    const connector = isFirst ? "" : "└── ";

    lines.push(formatTreeTask(ancestor, { prefix: indent + connector }));

    // If expand mode, show truncated description below the task line
    if (expand && ancestor.description) {
      const descIndent = indent + (isFirst ? "" : "    ") + "      ";
      const truncatedDesc = truncateText(
        ancestor.description,
        SHOW_TEXT_MAX_LENGTH,
      );
      lines.push(`${descIndent}${colors.dim}${truncatedDesc}${colors.reset}`);
    }
  }

  // Current task - highlighted
  const currentIndent =
    ancestors.length > 1 ? "    ".repeat(ancestors.length - 1) : "";
  const currentConnector = ancestors.length > 0 ? "└── " : "";
  const currentPrefix = currentIndent + currentConnector;
  lines.push(
    formatTreeTask(task, {
      prefix: currentPrefix,
      isCurrent: true,
      childCount: children.length,
    }),
  );

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
      const childGrandchildren = grandchildren.filter(
        (g) => g.parent_id === child.id,
      );
      lines.push(
        formatTreeTask(child, {
          prefix: childIndent + connector,
          childCount: childGrandchildren.length,
        }),
      );
    }
  }

  return lines;
}

/**
 * Format the detailed show view for a task with proper text wrapping.
 */
export function formatTaskShow(
  task: Task,
  options: FormatTaskShowOptions = {},
): string {
  const {
    ancestors = [],
    children = [],
    grandchildren = [],
    full = false,
    expand = false,
    blockedByTasks = [],
    blocksTasks = [],
    ancestorGithub,
  } = options;
  let wasTruncated = false;
  const priority =
    task.priority !== 1
      ? ` ${colors.cyan}[p${task.priority}]${colors.reset}`
      : "";

  const lines: string[] = [];

  // Hierarchy tree (if this task has ancestors or children)
  if (ancestors.length > 0 || children.length > 0) {
    lines.push(
      ...formatHierarchyTree(task, ancestors, children, grandchildren, {
        expand,
      }),
    );
    lines.push(""); // Blank line after tree
  } else {
    // No hierarchy - just show the task header
    const statusIcon = task.completed ? "[x]" : "[ ]";
    const statusColor = task.completed ? colors.green : colors.yellow;
    lines.push(
      `${statusColor}${statusIcon}${colors.reset} ${colors.bold}${task.id}${colors.reset}${priority}: ${task.name}`,
    );
    lines.push(""); // Blank line after header
  }

  // Blocked by section (incomplete blockers)
  const incompleteBlockers = blockedByTasks.filter((t) => !t.completed);
  if (incompleteBlockers.length > 0) {
    lines.push(`${colors.bold}${colors.red}Blocked by:${colors.reset}`);
    for (const blocker of incompleteBlockers) {
      lines.push(
        `  ${colors.dim}•${colors.reset} ${colors.bold}${blocker.id}${colors.reset}: ${truncateText(blocker.name, 50)}`,
      );
    }
    lines.push(""); // Blank line after
  }

  // Blocks section (tasks this one blocks that are not completed)
  const incompleteBlocked = blocksTasks.filter((t) => !t.completed);
  if (incompleteBlocked.length > 0) {
    lines.push(`${colors.bold}Blocks:${colors.reset}`);
    for (const blocked of incompleteBlocked) {
      lines.push(
        `  ${colors.dim}•${colors.reset} ${colors.bold}${blocked.id}${colors.reset}: ${truncateText(blocked.name, 50)}`,
      );
    }
    lines.push(""); // Blank line after
  }

  // Description section with word wrapping
  const indent = "  ";
  lines.push(`${colors.bold}Description:${colors.reset}`);
  const description = full
    ? { text: task.description, truncated: false }
    : truncateIfNeeded(task.description, SHOW_TEXT_MAX_LENGTH);
  wasTruncated ||= description.truncated;
  lines.push(wrapText(description.text, terminalWidth, indent));

  // Result section (if present) with word wrapping
  if (task.result) {
    lines.push(""); // Blank line before result
    lines.push(`${colors.bold}Result:${colors.reset}`);
    const result = full
      ? { text: task.result, truncated: false }
      : truncateIfNeeded(task.result, SHOW_TEXT_MAX_LENGTH);
    wasTruncated ||= result.truncated;
    lines.push(
      wrapText(
        `${colors.green}${result.text}${colors.reset}`,
        terminalWidth,
        indent,
      ),
    );
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

  // GitHub Issue section (if present)
  const github = task.metadata?.github ?? ancestorGithub;
  if (github) {
    const isFromAncestor = !task.metadata?.github && ancestorGithub;
    lines.push(""); // Blank line before GitHub section
    lines.push(`${colors.bold}GitHub Issue:${colors.reset}`);
    const issueInfo = `#${github.issueNumber} (${github.repo})${isFromAncestor ? " (via parent)" : ""}`;
    lines.push(`  ${colors.cyan}${issueInfo}${colors.reset}`);
    lines.push(`  ${colors.dim}${github.issueUrl}${colors.reset}`);
  }

  // Metadata section
  lines.push(""); // Blank line before metadata
  const labelWidth = 10;
  lines.push(
    `${"Created:".padEnd(labelWidth)} ${colors.dim}${task.created_at}${colors.reset}`,
  );
  lines.push(
    `${"Updated:".padEnd(labelWidth)} ${colors.dim}${task.updated_at}${colors.reset}`,
  );
  if (task.completed_at) {
    lines.push(
      `${"Completed:".padEnd(labelWidth)} ${colors.dim}${task.completed_at}${colors.reset}`,
    );
  }

  // More Information section (navigation hints)
  const parentTask =
    ancestors.length > 0 ? ancestors[ancestors.length - 1] : null;
  if (parentTask || children.length > 0 || wasTruncated) {
    lines.push("");
    lines.push(`${colors.bold}More Information:${colors.reset}`);

    if (parentTask) {
      lines.push(
        `  ${colors.dim}•${colors.reset} View parent task: ${colors.cyan}dex show ${parentTask.id}${colors.reset}`,
      );
    }
    if (children.length > 0) {
      lines.push(
        `  ${colors.dim}•${colors.reset} View subtree: ${colors.cyan}dex list ${task.id}${colors.reset}`,
      );
    }
    if (wasTruncated) {
      lines.push(
        `  ${colors.dim}•${colors.reset} View full content: ${colors.cyan}dex show ${task.id} --full${colors.reset}`,
      );
    }
  }

  return lines.join("\n");
}

export async function showCommand(
  args: string[],
  options: CliOptions,
): Promise<void> {
  const { positional, flags } = parseArgs(
    args,
    {
      json: { hasValue: false },
      full: { short: "f", hasValue: false },
      expand: { short: "e", hasValue: false },
      help: { short: "h", hasValue: false },
    },
    "show",
  );

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex show${colors.reset} - Show task details

${colors.bold}USAGE:${colors.reset}
  dex show <task-id>... [options]

${colors.bold}ARGUMENTS:${colors.reset}
  <task-id>...               One or more task IDs to display (required)

${colors.bold}OPTIONS:${colors.reset}
  -e, --expand               Show descriptions for ancestor tasks in tree
  -f, --full                 Show full description and result (no truncation)
  --json                     Output as JSON
  -h, --help                 Show this help message

${colors.bold}EXAMPLES:${colors.reset}
  dex show abc123            # Show task details
  dex show abc123 def456     # Show multiple tasks
  dex show abc123 --expand   # Show ancestor descriptions
  dex show abc123 --json     # Output as JSON for scripting
`);
    return;
  }

  const ids = positional;

  if (ids.length === 0) {
    console.error(`${colors.red}Error:${colors.reset} Task ID is required`);
    console.error(`Usage: dex show <task-id>...`);
    process.exit(1);
  }

  const service = createService(options);
  const full = getBooleanFlag(flags, "full");
  const expand = getBooleanFlag(flags, "expand");
  const jsonOutput = getBooleanFlag(flags, "json");

  // Process each task ID
  const results: unknown[] = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];

    // Add separator between tasks (for non-JSON output)
    if (i > 0 && !jsonOutput) {
      console.log("");
      console.log(`${colors.dim}${"─".repeat(60)}${colors.reset}`);
      console.log("");
    }

    // Check both active tasks and archive
    const taskOrArchived = await service.getWithArchive(id);

    // If not found anywhere
    if (!taskOrArchived) {
      await exitIfTaskNotFound(null, id, service);
      return;
    }

    // Handle archived task
    if (isArchivedTask(taskOrArchived)) {
      if (jsonOutput) {
        results.push({ ...taskOrArchived, archived: true });
        continue;
      }

      console.log(formatArchivedTaskShow(taskOrArchived, { full }));
      continue;
    }

    // Active task
    const task = taskOrArchived;

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

    // JSON output mode - collect results
    if (jsonOutput) {
      const pending = children.filter((c) => !c.completed);
      const pendingGrandchildren = grandchildren.filter((c) => !c.completed);
      const taskJson = {
        ...task,
        ancestors: ancestors.map((a) =>
          expand
            ? { id: a.id, name: a.name, description: a.description }
            : { id: a.id, name: a.name },
        ),
        depth: ancestors.length,
        subtasks: {
          pending: pending.length,
          completed: children.length - pending.length,
          children,
        },
        grandchildren:
          grandchildren.length > 0
            ? {
                pending: pendingGrandchildren.length,
                completed: grandchildren.length - pendingGrandchildren.length,
                tasks: grandchildren,
              }
            : null,
        blockedBy: blockedByTasks.map((t) => ({
          id: t.id,
          name: t.name,
          completed: t.completed,
        })),
        blocks: blocksTasks.map((t) => ({
          id: t.id,
          name: t.name,
          completed: t.completed,
        })),
        isBlocked: blockedByTasks.some((t) => !t.completed),
      };
      results.push(taskJson);
      continue;
    }

    // Extract GitHub metadata from ancestors (first one found walking up from closest parent)
    const ancestorGithub = [...ancestors]
      .reverse()
      .find((a) => a.metadata?.github)?.metadata?.github;

    console.log(
      formatTaskShow(task, {
        ancestors,
        children,
        grandchildren,
        full,
        expand,
        blockedByTasks,
        blocksTasks,
        ancestorGithub,
      }),
    );
  }

  // Output JSON results
  if (jsonOutput) {
    // Output as array if multiple tasks, single object if one task
    const output = results.length === 1 ? results[0] : results;
    console.log(JSON.stringify(output, null, 2));
  }
}

/**
 * Format an archived task for the show view.
 */
function formatArchivedTaskShow(
  task: ArchivedTask,
  options: { full?: boolean } = {},
): string {
  const { full = false } = options;
  let wasTruncated = false;
  const lines: string[] = [];

  // Header with ARCHIVED badge
  lines.push(
    `${colors.green}[x]${colors.reset} ${colors.bold}${task.id}${colors.reset}: ${task.name} ${colors.yellow}(ARCHIVED)${colors.reset}`,
  );
  lines.push("");

  // Description section
  lines.push(`${colors.bold}Description:${colors.reset}`);
  const descriptionText = task.description || "(no description)";
  const description = full
    ? { text: descriptionText, truncated: false }
    : truncateIfNeeded(descriptionText, SHOW_TEXT_MAX_LENGTH);
  wasTruncated ||= description.truncated;
  lines.push(wrapText(description.text, terminalWidth, "  "));

  // Result section
  if (task.result) {
    lines.push("");
    lines.push(`${colors.bold}Result:${colors.reset}`);
    const result = full
      ? { text: task.result, truncated: false }
      : truncateIfNeeded(task.result, SHOW_TEXT_MAX_LENGTH);
    wasTruncated ||= result.truncated;
    lines.push(
      wrapText(
        `${colors.green}${result.text}${colors.reset}`,
        terminalWidth,
        "  ",
      ),
    );
  }

  // GitHub Issue section
  if (task.metadata?.github) {
    const github = task.metadata.github;
    lines.push("");
    lines.push(`${colors.bold}GitHub Issue:${colors.reset}`);
    lines.push(
      `  ${colors.cyan}#${github.issueNumber} (${github.repo})${colors.reset}`,
    );
    lines.push(`  ${colors.dim}${github.issueUrl}${colors.reset}`);
  }

  // Commit section
  if (task.metadata?.commit) {
    const commit = task.metadata.commit;
    lines.push("");
    lines.push(`${colors.bold}Commit:${colors.reset}`);
    lines.push(`  SHA:    ${colors.cyan}${commit.sha}${colors.reset}`);
    if (commit.message) {
      lines.push(`  Message: ${commit.message}`);
    }
  }

  // Archived children section
  if (task.archived_children.length > 0) {
    lines.push("");
    lines.push(
      `${colors.bold}Archived Subtasks:${colors.reset} ${task.archived_children.length}`,
    );
    for (const child of task.archived_children) {
      lines.push(
        `  ${colors.green}[x]${colors.reset} ${colors.dim}${child.id}${colors.reset}: ${truncateText(child.name, 50)}`,
      );
    }
  }

  // Metadata section
  lines.push("");
  const labelWidth = 10;
  if (task.completed_at) {
    lines.push(
      `${"Completed:".padEnd(labelWidth)} ${colors.dim}${task.completed_at}${colors.reset}`,
    );
  }
  lines.push(
    `${"Archived:".padEnd(labelWidth)} ${colors.dim}${task.archived_at}${colors.reset}`,
  );

  // More Information section
  if (wasTruncated) {
    lines.push("");
    lines.push(`${colors.bold}More Information:${colors.reset}`);
    lines.push(
      `  ${colors.dim}•${colors.reset} View full content: ${colors.cyan}dex show ${task.id} --full${colors.reset}`,
    );
  }

  return lines.join("\n");
}
