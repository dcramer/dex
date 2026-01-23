import { Task } from "../types.js";
import {
  CliOptions,
  colors,
  createService,
  formatAge,
  getBooleanFlag,
  parseArgs,
  terminalWidth,
  truncateText,
  wrapText,
} from "./utils.js";

// Default max length for context/result text in show command (use --full to see all)
const SHOW_TEXT_MAX_LENGTH = 200;

// Max description length for subtask display in show command
const SHOW_SUBTASK_DESCRIPTION_MAX_LENGTH = 50;

interface FormatTaskShowOptions {
  full?: boolean;
  parentTask?: Task | null;
  children?: Task[];
}

/**
 * Format the detailed show view for a task with proper text wrapping.
 */
export function formatTaskShow(task: Task, options: FormatTaskShowOptions = {}): string {
  const { full = false, parentTask, children = [] } = options;
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
  let contextText = task.context;
  if (!full && contextText.length > SHOW_TEXT_MAX_LENGTH) {
    contextText = contextText.slice(0, SHOW_TEXT_MAX_LENGTH) + "...";
  }
  lines.push(`${colors.bold}Context:${colors.reset}`);
  lines.push(wrapText(contextText, terminalWidth, indent));

  // Result section (if present) with word wrapping
  if (task.result) {
    lines.push(""); // Blank line before result
    let resultText = task.result;
    if (!full && resultText.length > SHOW_TEXT_MAX_LENGTH) {
      resultText = resultText.slice(0, SHOW_TEXT_MAX_LENGTH) + "...";
    }
    lines.push(`${colors.bold}Result:${colors.reset}`);
    lines.push(wrapText(`${colors.green}${resultText}${colors.reset}`, terminalWidth, indent));
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

  // Add hint if text was truncated
  if (!full && (task.context.length > SHOW_TEXT_MAX_LENGTH || (task.result && task.result.length > SHOW_TEXT_MAX_LENGTH))) {
    lines.push("");
    lines.push(`${colors.dim}(Text truncated. Use --full to see complete content.)${colors.reset}`);
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
  -f, --full                 Show full context/result (no truncation)
  --json                     Output as JSON
  -h, --help                 Show this help message

${colors.bold}EXAMPLE:${colors.reset}
  dex show abc123            # Show task details (truncated)
  dex show abc123 --full     # Show complete context and result
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
  const task = await service.get(id);

  if (!task) {
    console.error(`${colors.red}Error:${colors.reset} Task ${colors.bold}${id}${colors.reset} not found`);
    // Suggest looking at available tasks
    const allTasks = await service.list({ all: true });
    if (allTasks.length > 0) {
      console.error(`Hint: Run "${colors.dim}dex list --all${colors.reset}" to see all tasks`);
    }
    process.exit(1);
  }

  const children = await service.getChildren(id);
  const parentTask = task.parent_id ? await service.get(task.parent_id) : null;
  const full = getBooleanFlag(flags, "full");

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

  console.log(formatTaskShow(task, { full, parentTask, children }));
}
