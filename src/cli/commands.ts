import { TaskService } from "../core/task-service.js";
import { Task, TaskStatus } from "../types.js";
import { DexError } from "../errors.js";
import * as readline from "readline";

interface CliOptions {
  storagePath?: string;
}

interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

// Color support: disable if NO_COLOR is set or stdout is not a TTY
const useColors = !process.env.NO_COLOR && process.stdout.isTTY;

// ANSI color codes (only used when colors are enabled)
const colors = {
  reset: useColors ? "\x1b[0m" : "",
  bold: useColors ? "\x1b[1m" : "",
  dim: useColors ? "\x1b[2m" : "",
  red: useColors ? "\x1b[31m" : "",
  green: useColors ? "\x1b[32m" : "",
  yellow: useColors ? "\x1b[33m" : "",
  blue: useColors ? "\x1b[34m" : "",
  cyan: useColors ? "\x1b[36m" : "",
};

// Available commands for suggestions
const COMMANDS = ["create", "list", "show", "edit", "complete", "delete", "projects", "help", "mcp"];

function createService(options: CliOptions): TaskService {
  return new TaskService(options.storagePath);
}

/**
 * Format an error for CLI output with proper coloring and suggestions.
 */
function formatCliError(err: unknown): string {
  let message: string;
  let suggestion: string | undefined;

  if (err instanceof DexError) {
    message = err.message;
    suggestion = err.suggestion;
  } else if (err instanceof Error) {
    message = err.message;
  } else {
    message = String(err);
  }

  let output = `${colors.red}Error:${colors.reset} ${message}`;
  if (suggestion) {
    output += `\n${colors.dim}Hint: ${suggestion}${colors.reset}`;
  }
  return output;
}

// Calculate Levenshtein distance for command suggestions
function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

function getSuggestion(input: string): string | null {
  let bestMatch: string | null = null;
  let bestDistance = Infinity;

  for (const cmd of COMMANDS) {
    const distance = levenshtein(input.toLowerCase(), cmd);
    if (distance < bestDistance && distance <= 2) {
      bestDistance = distance;
      bestMatch = cmd;
    }
  }

  return bestMatch;
}

function promptConfirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

function formatTask(task: Task, verbose: boolean = false, treePrefix: string = ""): string {
  const statusIcon = task.status === "completed" ? "[x]" : "[ ]";
  const statusColor = task.status === "completed" ? colors.green : colors.yellow;
  const priority = task.priority !== 1 ? ` ${colors.cyan}[p${task.priority}]${colors.reset}` : "";
  const project = task.project !== "default" ? ` ${colors.dim}(${task.project})${colors.reset}` : "";

  let output = `${treePrefix}${statusColor}${statusIcon}${colors.reset} ${colors.bold}${task.id}${colors.reset}${priority}${project}: ${task.description}`;

  if (verbose) {
    const labelWidth = 12;
    // For verbose output, create a continuation prefix that aligns with the tree
    const verbosePrefix = treePrefix
      .replace(/\|-- $/, "|   ")
      .replace(/`-- $/, "    ");
    output += `\n${verbosePrefix}  ${"Context:".padEnd(labelWidth)} ${task.context}`;
    if (task.result) {
      output += `\n${verbosePrefix}  ${"Result:".padEnd(labelWidth)} ${colors.green}${task.result}${colors.reset}`;
    }
    output += `\n${verbosePrefix}  ${"Created:".padEnd(labelWidth)} ${colors.dim}${task.created_at}${colors.reset}`;
    output += `\n${verbosePrefix}  ${"Updated:".padEnd(labelWidth)} ${colors.dim}${task.updated_at}${colors.reset}`;
    if (task.completed_at) {
      output += `\n${verbosePrefix}  ${"Completed:".padEnd(labelWidth)} ${colors.dim}${task.completed_at}${colors.reset}`;
    }
  }

  return output;
}

function formatTaskJson(task: Task): object {
  return {
    id: task.id,
    parent_id: task.parent_id,
    project: task.project,
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

function getStringFlag(flags: ParsedArgs["flags"], name: string): string | undefined {
  const value = flags[name];
  // Treat empty strings as missing values (can happen when flag is at end of args)
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return undefined;
}

function getBooleanFlag(flags: ParsedArgs["flags"], name: string): boolean {
  return flags[name] === true;
}

function parseIntFlag(flags: ParsedArgs["flags"], name: string): number | undefined {
  const value = getStringFlag(flags, name);
  if (value === undefined) {
    return undefined;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    console.error(`${colors.red}Error:${colors.reset} Invalid value for --${name}: expected a number, got "${value}"`);
    process.exit(1);
  }
  return parsed;
}

export function runCli(args: string[], options: CliOptions = {}): void {
  const command = args[0];

  switch (command) {
    case "create":
      return createCommand(args.slice(1), options);
    case "list":
      return listCommand(args.slice(1), options);
    case "show":
      return showCommand(args.slice(1), options);
    case "edit":
      return editCommand(args.slice(1), options);
    case "complete":
      return completeCommand(args.slice(1), options);
    case "delete":
      return deleteCommandAsync(args.slice(1), options);
    case "projects":
      return projectsCommand(args.slice(1), options);
    case "help":
    case "--help":
    case "-h":
      return helpCommand();
    default:
      if (!command) {
        return listCommand([], options);
      }
      console.error(`${colors.red}Error:${colors.reset} Unknown command: ${command}`);
      const suggestion = getSuggestion(command);
      if (suggestion) {
        console.error(`Did you mean "${colors.cyan}${suggestion}${colors.reset}"?`);
      }
      console.error(`Run "${colors.dim}dex help${colors.reset}" for usage information.`);
      process.exit(1);
  }
}

interface FlagConfig {
  short?: string;
  hasValue: boolean;
}

/**
 * Suggest a similar flag name using Levenshtein distance.
 */
function getFlagSuggestion(input: string, flagDefs: Record<string, FlagConfig>): string | null {
  const flagNames = Object.keys(flagDefs);
  let bestMatch: string | null = null;
  let bestDistance = Infinity;

  for (const flag of flagNames) {
    const distance = levenshtein(input.toLowerCase(), flag.toLowerCase());
    if (distance < bestDistance && distance <= 2) {
      bestDistance = distance;
      bestMatch = flag;
    }
  }

  return bestMatch;
}

function parseArgs(
  args: string[],
  flagDefs: Record<string, FlagConfig>,
  commandName?: string
): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const unknownFlags: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith("--")) {
      const flagName = arg.slice(2);
      const flagConfig = flagDefs[flagName];

      if (flagConfig) {
        if (flagConfig.hasValue) {
          flags[flagName] = args[++i] || "";
        } else {
          flags[flagName] = true;
        }
      } else {
        // Unknown long flag
        unknownFlags.push(arg);
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      const shortFlag = arg.slice(1);
      const flagEntry = Object.entries(flagDefs).find(
        ([, config]) => config.short === shortFlag
      );

      if (flagEntry) {
        const [flagName, flagConfig] = flagEntry;
        if (flagConfig.hasValue) {
          flags[flagName] = args[++i] || "";
        } else {
          flags[flagName] = true;
        }
      } else {
        // Unknown short flag
        unknownFlags.push(arg);
      }
    } else if (arg.startsWith("-") && arg.length > 2) {
      // Unknown flag like -abc or --flag=value style not supported
      unknownFlags.push(arg);
    } else {
      positional.push(arg);
    }
  }

  // Report unknown flags
  if (unknownFlags.length > 0) {
    const flag = unknownFlags[0];
    const flagName = flag.replace(/^-+/, "");
    const suggestion = getFlagSuggestion(flagName, flagDefs);

    let errorMsg = `${colors.red}Error:${colors.reset} Unknown option: ${flag}`;
    if (suggestion) {
      errorMsg += `\nDid you mean "--${suggestion}"?`;
    }

    const cmd = commandName ? `dex ${commandName}` : "dex <command>";
    errorMsg += `\nRun '${colors.dim}${cmd} --help${colors.reset}' for usage.`;

    console.error(errorMsg);
    process.exit(1);
  }

  return { positional, flags };
}

function createCommand(args: string[], options: CliOptions): void {
  const { flags } = parseArgs(args, {
    description: { short: "d", hasValue: true },
    context: { hasValue: true },
    project: { hasValue: true },
    priority: { short: "p", hasValue: true },
    parent: { hasValue: true },
    help: { short: "h", hasValue: false },
  }, "create");

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex create${colors.reset} - Create a new task

${colors.bold}USAGE:${colors.reset}
  dex create -d "description" --context "context" [options]

${colors.bold}OPTIONS:${colors.reset}
  -d, --description <text>   Task description (required)
  --context <text>           Task context/details (required)
  --project <name>           Project grouping (default: "default")
  -p, --priority <n>         Priority level (lower = higher priority, default: 1)
  --parent <id>              Parent task ID (creates subtask)
  -h, --help                 Show this help message

${colors.bold}EXAMPLE:${colors.reset}
  dex create -d "Fix login bug" --context "Users report 500 errors on /login"
  dex create -d "Write tests" --context "Cover auth module" --project auth -p 2
  dex create -d "Subtask" --context "Part of bigger task" --parent abc123
`);
    return;
  }

  const description = getStringFlag(flags, "description");
  const context = getStringFlag(flags, "context");

  if (!description) {
    console.error(`${colors.red}Error:${colors.reset} --description (-d) is required`);
    console.error(`Usage: dex create -d "task description" --context "context info"`);
    process.exit(1);
  }

  if (!context) {
    console.error(`${colors.red}Error:${colors.reset} --context is required`);
    console.error(`Usage: dex create -d "task description" --context "context info"`);
    process.exit(1);
  }

  const service = createService(options);
  try {
    const task = service.create({
      description,
      context,
      parent_id: getStringFlag(flags, "parent"),
      project: getStringFlag(flags, "project"),
      priority: parseIntFlag(flags, "priority"),
    });

    console.log(`${colors.green}Created${colors.reset} task ${colors.bold}${task.id}${colors.reset}`);
    console.log(formatTask(task));
  } catch (err) {
    console.error(formatCliError(err));
    process.exit(1);
  }
}

function printTaskTree(tasks: Task[], parentId: string | null, prefix: string = "", isRoot: boolean = true): void {
  const children = tasks
    .filter((t) => t.parent_id === parentId)
    .toSorted((a, b) => a.priority - b.priority);

  for (let i = 0; i < children.length; i++) {
    const task = children[i];
    const isLast = i === children.length - 1;

    if (isRoot) {
      // Root level tasks: no tree connectors
      console.log(formatTask(task, false, ""));
      printTaskTree(tasks, task.id, "", false);
    } else {
      // Child tasks: use tree connectors
      const connector = isLast ? "`-- " : "|-- ";
      const childPrefix = prefix + (isLast ? "    " : "|   ");
      console.log(formatTask(task, false, prefix + connector));
      printTaskTree(tasks, task.id, childPrefix, false);
    }
  }
}

function listCommand(args: string[], options: CliOptions): void {
  const { flags } = parseArgs(args, {
    all: { short: "a", hasValue: false },
    status: { short: "s", hasValue: true },
    project: { hasValue: true },
    query: { short: "q", hasValue: true },
    flat: { short: "f", hasValue: false },
    json: { hasValue: false },
    help: { short: "h", hasValue: false },
  }, "list");

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex list${colors.reset} - List tasks

${colors.bold}USAGE:${colors.reset}
  dex list [options]

${colors.bold}OPTIONS:${colors.reset}
  -a, --all                  Include completed tasks
  -s, --status <status>      Filter by status (pending, completed)
  --project <name>           Filter by project
  -q, --query <text>         Search in description and context
  -f, --flat                 Show flat list instead of tree view
  --json                     Output as JSON
  -h, --help                 Show this help message

${colors.bold}EXAMPLE:${colors.reset}
  dex list                   # Show pending tasks as tree
  dex list --all             # Include completed tasks
  dex list --project auth    # Filter by project
  dex list -q "login" --flat # Search and show flat list
  dex list --json | jq '.'   # Output JSON for scripting
`);
    return;
  }

  const statusValue = getStringFlag(flags, "status");
  let status: TaskStatus | undefined;
  if (statusValue !== undefined) {
    if (statusValue !== "pending" && statusValue !== "completed") {
      console.error(`${colors.red}Error:${colors.reset} Invalid value for --status: expected "pending" or "completed", got "${statusValue}"`);
      process.exit(1);
    }
    status = statusValue;
  }

  const service = createService(options);
  const tasks = service.list({
    all: getBooleanFlag(flags, "all") || undefined,
    status,
    project: getStringFlag(flags, "project"),
    query: getStringFlag(flags, "query"),
  });

  // JSON output mode
  if (getBooleanFlag(flags, "json")) {
    console.log(JSON.stringify(tasks.map(formatTaskJson), null, 2));
    return;
  }

  if (tasks.length === 0) {
    console.log("No tasks found.");
    return;
  }

  if (getBooleanFlag(flags, "flat")) {
    for (const task of tasks) {
      console.log(formatTask(task));
    }
  } else {
    printTaskTree(tasks, null, "");
  }
}

function showCommand(args: string[], options: CliOptions): void {
  const { positional, flags } = parseArgs(args, {
    json: { hasValue: false },
    help: { short: "h", hasValue: false },
  }, "show");

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex show${colors.reset} - Show task details

${colors.bold}USAGE:${colors.reset}
  dex show <task-id> [options]

${colors.bold}ARGUMENTS:${colors.reset}
  <task-id>                  Task ID to display (required)

${colors.bold}OPTIONS:${colors.reset}
  --json                     Output as JSON
  -h, --help                 Show this help message

${colors.bold}EXAMPLE:${colors.reset}
  dex show abc123            # Show task details and subtask count
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
  const task = service.get(id);

  if (!task) {
    console.error(`${colors.red}Error:${colors.reset} Task ${colors.bold}${id}${colors.reset} not found`);
    // Suggest looking at available tasks
    const allTasks = service.list({ all: true });
    if (allTasks.length > 0) {
      console.error(`Hint: Run "${colors.dim}dex list --all${colors.reset}" to see all tasks`);
    }
    process.exit(1);
  }

  const children = service.getChildren(id);

  // JSON output mode
  if (getBooleanFlag(flags, "json")) {
    const output = {
      ...formatTaskJson(task),
      subtasks: {
        pending: children.filter((c) => c.status === "pending").length,
        completed: children.filter((c) => c.status === "completed").length,
        children: children.map(formatTaskJson),
      },
    };
    console.log(JSON.stringify(output, null, 2));
    return;
  }

  console.log(formatTask(task, true));

  if (children.length > 0) {
    const pending = children.filter((c) => c.status === "pending").length;
    const completed = children.filter((c) => c.status === "completed").length;
    console.log(`\n  Subtasks: ${colors.yellow}${pending} pending${colors.reset}, ${colors.green}${completed} completed${colors.reset}`);
  }
}

function editCommand(args: string[], options: CliOptions): void {
  const { positional, flags } = parseArgs(args, {
    description: { short: "d", hasValue: true },
    context: { hasValue: true },
    project: { hasValue: true },
    priority: { short: "p", hasValue: true },
    parent: { hasValue: true },
    help: { short: "h", hasValue: false },
  }, "edit");

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex edit${colors.reset} - Edit an existing task

${colors.bold}USAGE:${colors.reset}
  dex edit <task-id> [options]

${colors.bold}ARGUMENTS:${colors.reset}
  <task-id>                  Task ID to edit (required)

${colors.bold}OPTIONS:${colors.reset}
  -d, --description <text>   New task description
  --context <text>           New task context/details
  --project <name>           Move to different project
  -p, --priority <n>         New priority level
  --parent <id>              New parent task ID
  -h, --help                 Show this help message

${colors.bold}EXAMPLE:${colors.reset}
  dex edit abc123 -d "Updated description"
  dex edit abc123 --project backend -p 1
  dex edit abc123 --context "More details about the task"
`);
    return;
  }

  const id = positional[0];

  if (!id) {
    console.error(`${colors.red}Error:${colors.reset} Task ID is required`);
    console.error(`Usage: dex edit <task-id> [-d "new description"]`);
    process.exit(1);
  }

  const service = createService(options);
  try {
    const task = service.update({
      id,
      description: getStringFlag(flags, "description"),
      context: getStringFlag(flags, "context"),
      parent_id: getStringFlag(flags, "parent"),
      project: getStringFlag(flags, "project"),
      priority: parseIntFlag(flags, "priority"),
    });

    console.log(`${colors.green}Updated${colors.reset} task ${colors.bold}${id}${colors.reset}`);
    console.log(formatTask(task));
  } catch (err) {
    console.error(formatCliError(err));
    process.exit(1);
  }
}

function completeCommand(args: string[], options: CliOptions): void {
  const { positional, flags } = parseArgs(args, {
    result: { short: "r", hasValue: true },
    help: { short: "h", hasValue: false },
  }, "complete");

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex complete${colors.reset} - Mark a task as completed

${colors.bold}USAGE:${colors.reset}
  dex complete <task-id> --result "completion notes"

${colors.bold}ARGUMENTS:${colors.reset}
  <task-id>                  Task ID to complete (required)

${colors.bold}OPTIONS:${colors.reset}
  -r, --result <text>        Completion result/notes (required)
  -h, --help                 Show this help message

${colors.bold}EXAMPLE:${colors.reset}
  dex complete abc123 --result "Fixed by updating auth token refresh logic"
  dex complete abc123 -r "Implemented and tested"
`);
    return;
  }

  const id = positional[0];
  const result = getStringFlag(flags, "result");

  if (!id) {
    console.error(`${colors.red}Error:${colors.reset} Task ID is required`);
    console.error(`Usage: dex complete <task-id> --result "completion notes"`);
    process.exit(1);
  }

  if (!result) {
    console.error(`${colors.red}Error:${colors.reset} --result (-r) is required`);
    console.error(`Usage: dex complete <task-id> --result "completion notes"`);
    process.exit(1);
  }

  const service = createService(options);
  try {
    const task = service.complete(id, result);

    console.log(`${colors.green}Completed${colors.reset} task ${colors.bold}${id}${colors.reset}`);
    console.log(formatTask(task, true));
  } catch (err) {
    console.error(formatCliError(err));
    process.exit(1);
  }
}

function deleteCommandAsync(args: string[], options: CliOptions): void {
  const { positional, flags } = parseArgs(args, {
    force: { short: "f", hasValue: false },
    help: { short: "h", hasValue: false },
  }, "delete");

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex delete${colors.reset} - Delete a task

${colors.bold}USAGE:${colors.reset}
  dex delete <task-id> [options]

${colors.bold}ARGUMENTS:${colors.reset}
  <task-id>                  Task ID to delete (required)

${colors.bold}OPTIONS:${colors.reset}
  -f, --force                Delete without confirmation (even if has subtasks)
  -h, --help                 Show this help message

${colors.bold}EXAMPLE:${colors.reset}
  dex delete abc123          # Prompts if task has subtasks
  dex delete abc123 -f       # Force delete without prompting
`);
    return;
  }

  const id = positional[0];
  const force = getBooleanFlag(flags, "force");

  if (!id) {
    console.error(`${colors.red}Error:${colors.reset} Task ID is required`);
    console.error(`Usage: dex delete <task-id>`);
    process.exit(1);
  }

  const service = createService(options);
  const task = service.get(id);

  if (!task) {
    console.error(`${colors.red}Error:${colors.reset} Task ${colors.bold}${id}${colors.reset} not found`);
    const allTasks = service.list({ all: true });
    if (allTasks.length > 0) {
      console.error(`${colors.dim}Hint: Run "dex list --all" to see all tasks${colors.reset}`);
    }
    process.exit(1);
  }

  const children = service.getChildren(id);

  // If task has children and not forced, prompt for confirmation
  if (children.length > 0 && !force) {
    const childCount = children.length;
    const message = `Task ${id} has ${childCount} subtask${childCount > 1 ? "s" : ""} that will also be deleted. Continue? (y/n) `;

    promptConfirm(message).then((confirmed) => {
      if (!confirmed) {
        console.log("Aborted.");
        process.exit(0);
      }

      try {
        service.delete(id);
        console.log(`${colors.green}Deleted${colors.reset} task ${colors.bold}${id}${colors.reset} and ${childCount} subtask${childCount > 1 ? "s" : ""}`);
      } catch (err) {
        console.error(formatCliError(err));
        process.exit(1);
      }
    });
  } else {
    try {
      service.delete(id);
      if (children.length > 0) {
        console.log(`${colors.green}Deleted${colors.reset} task ${colors.bold}${id}${colors.reset} and ${children.length} subtask${children.length > 1 ? "s" : ""}`);
      } else {
        console.log(`${colors.green}Deleted${colors.reset} task ${colors.bold}${id}${colors.reset}`);
      }
    } catch (err) {
      console.error(formatCliError(err));
      process.exit(1);
    }
  }
}

function projectsCommand(args: string[], options: CliOptions): void {
  const { flags } = parseArgs(args, {
    json: { hasValue: false },
    help: { short: "h", hasValue: false },
  }, "projects");

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex projects${colors.reset} - List all projects

${colors.bold}USAGE:${colors.reset}
  dex projects [options]

${colors.bold}OPTIONS:${colors.reset}
  --json                     Output as JSON
  -h, --help                 Show this help message

${colors.bold}EXAMPLE:${colors.reset}
  dex projects               # List all projects with task counts
  dex projects --json        # Output as JSON for scripting
`);
    return;
  }

  const service = createService(options);
  const projects = service.listProjects();

  // JSON output mode
  if (getBooleanFlag(flags, "json")) {
    console.log(JSON.stringify(projects, null, 2));
    return;
  }

  if (projects.length === 0) {
    console.log("No projects found.");
    return;
  }

  // Calculate max project name width for alignment
  const maxNameWidth = Math.max(...projects.map((p) => p.project.length));

  for (const proj of projects) {
    const total = proj.pending + proj.completed;
    const name = proj.project.padEnd(maxNameWidth);
    console.log(`${colors.bold}${name}${colors.reset}  ${colors.yellow}${proj.pending} pending${colors.reset}, ${colors.green}${proj.completed} completed${colors.reset} ${colors.dim}(${total} total)${colors.reset}`);
  }
}

function helpCommand(): void {
  console.log(`${colors.bold}dex${colors.reset} - Task tracking tool

${colors.bold}USAGE:${colors.reset}
  dex <command> [options]

${colors.bold}COMMANDS:${colors.reset}
  mcp                              Start MCP server (stdio)
  create -d "..." --context "..."  Create task
  list                             List pending tasks (tree view)
  list --flat                      List without tree hierarchy
  list --all                       Include completed tasks
  list --status completed          Filter by status
  list --project "auth"            Filter by project
  list --query "login"             Search description/context
  list --json                      Output as JSON (for scripts)
  show <id>                        View task details + subtask count
  show <id> --json                 Output as JSON (for scripts)
  edit <id> [-d "..."]             Edit task
  complete <id> --result "..."     Mark completed with result
  delete <id>                      Remove task (prompts if has subtasks)
  delete <id> -f                   Force delete without confirmation
  projects                         List all projects
  projects --json                  Output as JSON (for scripts)

${colors.bold}OPTIONS:${colors.reset}
  --storage-path <path>            Override storage file location
  -p, --priority <n>               Task priority (lower = higher priority)
  --project <name>                 Project grouping
  --parent <id>                    Parent task (creates subtask)
  --json                           Output as JSON (list, show, projects)

${colors.bold}ENVIRONMENT:${colors.reset}
  NO_COLOR                         Disable colored output

${colors.bold}EXAMPLES:${colors.reset}
  dex create -d "Fix login bug" --context "Users report 500 errors"
  dex create -d "Subtask" --context "..." --parent abc123
  dex list --project auth
  dex list --json | jq '.[] | .id'
  dex complete abc123 --result "Fixed by updating auth token refresh"
`);
}
