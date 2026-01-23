import { Task, TaskStatus } from "../types.js";
import {
  CliOptions,
  colors,
  createService,
  formatTask,
  getBooleanFlag,
  getStringFlag,
  parseArgs,
} from "./utils.js";

// Max description length for list view (to keep tree readable)
const LIST_DESCRIPTION_MAX_LENGTH = 60;

function printTaskTree(tasks: Task[], parentId: string | null, prefix: string = "", isRoot: boolean = true): void {
  const children = tasks
    .filter((t) => t.parent_id === parentId)
    .toSorted((a, b) => a.priority - b.priority);

  for (let i = 0; i < children.length; i++) {
    const task = children[i];
    const isLast = i === children.length - 1;

    if (isRoot) {
      // Root level tasks: no tree connectors
      console.log(formatTask(task, { truncateDescription: LIST_DESCRIPTION_MAX_LENGTH }));
      printTaskTree(tasks, task.id, "", false);
    } else {
      // Child tasks: use tree connectors
      const connector = isLast ? "└── " : "├── ";
      const childPrefix = prefix + (isLast ? "    " : "│   ");
      console.log(formatTask(task, { treePrefix: prefix + connector, truncateDescription: LIST_DESCRIPTION_MAX_LENGTH }));
      printTaskTree(tasks, task.id, childPrefix, false);
    }
  }
}

export async function listCommand(args: string[], options: CliOptions): Promise<void> {
  const { flags } = parseArgs(args, {
    all: { short: "a", hasValue: false },
    status: { short: "s", hasValue: true },
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
  -q, --query <text>         Search in description and context
  -f, --flat                 Show flat list instead of tree view
  --json                     Output as JSON
  -h, --help                 Show this help message

${colors.bold}EXAMPLE:${colors.reset}
  dex list                   # Show pending tasks as tree
  dex list --all             # Include completed tasks
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
  const tasks = await service.list({
    all: getBooleanFlag(flags, "all") || undefined,
    status,
    query: getStringFlag(flags, "query"),
  });

  // JSON output mode
  if (getBooleanFlag(flags, "json")) {
    console.log(JSON.stringify(tasks, null, 2));
    return;
  }

  if (tasks.length === 0) {
    console.log("No tasks found.");
    return;
  }

  if (getBooleanFlag(flags, "flat")) {
    for (const task of tasks) {
      console.log(formatTask(task, { truncateDescription: LIST_DESCRIPTION_MAX_LENGTH }));
    }
  } else {
    printTaskTree(tasks, null, "");
  }
}
