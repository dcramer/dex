import { Task } from "../types.js";
import {
  CliOptions,
  colors,
  createService,
  exitIfTaskNotFound,
  formatAge,
  getBooleanFlag,
  parseArgs,
  terminalWidth,
  truncateText,
  wrapText,
} from "./utils.js";

// Max description length for subtask display in show command
const SHOW_SUBTASK_DESCRIPTION_MAX_LENGTH = 50;

interface FormatTaskShowOptions {
  parentTask?: Task | null;
  children?: Task[];
}

/**
 * Format the detailed show view for a task with proper text wrapping.
 */
export function formatTaskShow(task: Task, options: FormatTaskShowOptions = {}): string {
  const { parentTask, children = [] } = options;
  const statusIcon = task.status === "completed" ? "[x]" : "[ ]";
  const statusColor = task.status === "completed" ? colors.green : colors.yellow;
  const priority = task.priority !== 1 ? ` ${colors.cyan}[p${task.priority}]${colors.reset}` : "";

  const lines: string[] = [];

  // Parent task reference (if this task has a parent)
  if (parentTask) {
    const parentDesc = truncateText(parentTask.description, 50);
    lines.push(`${colors.dim}Parent: ${parentTask.id} - ${parentDesc}${colors.reset}`);
    lines.push(""); // Blank line after parent
  }

  // Header line with status, ID, priority, and description
  lines.push(`${statusColor}${statusIcon}${colors.reset} ${colors.bold}${task.id}${colors.reset}${priority}: ${task.description}`);
  lines.push(""); // Blank line after header

  // Context section with word wrapping
  const indent = "  ";
  lines.push(`${colors.bold}Context:${colors.reset}`);
  lines.push(wrapText(task.context, terminalWidth, indent));

  // Result section (if present) with word wrapping
  if (task.result) {
    lines.push(""); // Blank line before result
    lines.push(`${colors.bold}Result:${colors.reset}`);
    lines.push(wrapText(`${colors.green}${task.result}${colors.reset}`, terminalWidth, indent));
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

  // Subtasks section (if task has children)
  if (children.length > 0) {
    const pending = children.filter((c) => c.status === "pending").length;
    const completed = children.filter((c) => c.status === "completed").length;

    // Sort by priority then status (pending first)
    const sortedChildren = [...children].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      if (a.status !== b.status) return a.status === "pending" ? -1 : 1;
      return 0;
    });

    lines.push(""); // Blank line before subtasks
    lines.push(`${colors.bold}Subtasks${colors.reset} (${colors.yellow}${pending} pending${colors.reset}, ${colors.green}${completed} completed${colors.reset}):`);

    for (let i = 0; i < sortedChildren.length; i++) {
      const child = sortedChildren[i];
      const isLast = i === sortedChildren.length - 1;
      const connector = isLast ? "└──" : "├──";
      const childStatusIcon = child.status === "completed" ? "[x]" : "[ ]";
      const childStatusColor = child.status === "completed" ? colors.green : colors.yellow;
      const childDesc = truncateText(child.description, SHOW_SUBTASK_DESCRIPTION_MAX_LENGTH);
      const childAge = child.status === "completed" && child.completed_at
        ? ` ${colors.dim}(${formatAge(child.completed_at)})${colors.reset}`
        : "";

      lines.push(`${connector} ${childStatusColor}${childStatusIcon}${colors.reset} ${child.id}: ${childDesc}${childAge}`);
    }
  }

  // More Information section (navigation hints)
  if (parentTask || children.length > 0) {
    lines.push("");
    lines.push(`${colors.bold}More Information:${colors.reset}`);

    if (parentTask) {
      lines.push(`  ${colors.dim}•${colors.reset} View parent task: ${colors.cyan}dex show ${parentTask.id}${colors.reset}`);
    }
    if (children.length > 0) {
      lines.push(`  ${colors.dim}•${colors.reset} View subtasks: ${colors.cyan}dex list --parent ${task.id}${colors.reset}`);
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
  -f, --full                 (Deprecated - kept for compatibility)
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
  const parentTask = task.parent_id ? await service.get(task.parent_id) : null;

  // JSON output mode
  if (getBooleanFlag(flags, "json")) {
    const pending = children.filter((c) => c.status === "pending");
    const jsonOutput = {
      ...task,
      parent: parentTask ?? null,
      subtasks: {
        pending: pending.length,
        completed: children.length - pending.length,
        children,
      },
    };
    console.log(JSON.stringify(jsonOutput, null, 2));
    return;
  }

  console.log(formatTaskShow(task, { parentTask, children }));
}
