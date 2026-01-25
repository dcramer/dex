import { Task } from "../types.js";
import {
  CliOptions,
  colors,
  createService,
  formatTask,
  formatBreadcrumb,
  getBooleanFlag,
  getIncompleteBlockerIds,
  getStringFlag,
  parseArgs,
  parseIntFlag,
} from "./utils.js";
import { getGitHubIssueNumber } from "../core/github-sync.js";

// Max description length for list view (to keep tree readable)
const LIST_DESCRIPTION_MAX_LENGTH = 60;

function printTaskTree(tasks: Task[], allTasks: Task[], parentId: string | null, prefix: string = "", isRoot: boolean = true): void {
  const children = tasks
    .filter((t) => t.parent_id === parentId)
    .toSorted((a, b) => a.priority - b.priority);

  for (let i = 0; i < children.length; i++) {
    const task = children[i];
    const isLast = i === children.length - 1;
    const blockedByIds = getIncompleteBlockerIds(allTasks, task);

    if (isRoot) {
      // Root level tasks: no tree connectors
      console.log(formatTask(task, { truncateDescription: LIST_DESCRIPTION_MAX_LENGTH, blockedByIds }));
      printTaskTree(tasks, allTasks, task.id, "", false);
    } else {
      // Child tasks: use tree connectors
      const connector = isLast ? "└── " : "├── ";
      const childPrefix = prefix + (isLast ? "    " : "│   ");
      console.log(formatTask(task, { treePrefix: prefix + connector, truncateDescription: LIST_DESCRIPTION_MAX_LENGTH, blockedByIds }));
      printTaskTree(tasks, allTasks, task.id, childPrefix, false);
    }
  }
}

export async function listCommand(args: string[], options: CliOptions): Promise<void> {
  const { positional, flags } = parseArgs(args, {
    all: { short: "a", hasValue: false },
    completed: { short: "c", hasValue: false },
    query: { short: "q", hasValue: true },
    flat: { short: "f", hasValue: false },
    blocked: { short: "b", hasValue: false },
    ready: { short: "r", hasValue: false },
    issue: { hasValue: true },
    commit: { hasValue: true },
    json: { hasValue: false },
    help: { short: "h", hasValue: false },
  }, "list");

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex list${colors.reset} - List tasks

${colors.bold}USAGE:${colors.reset}
  dex list [filter] [options]

${colors.bold}ARGUMENTS:${colors.reset}
  [filter]                   Task ID (shows subtree) or search query

${colors.bold}OPTIONS:${colors.reset}
  -a, --all                  Include completed tasks
  -c, --completed            Show only completed tasks
  -b, --blocked              Show only blocked tasks (have incomplete blockers)
  -r, --ready                Show only ready tasks (pending with no blockers)
  -q, --query <text>         Search in description and context (deprecated: use positional)
  -f, --flat                 Show flat list instead of tree view
  --issue <number>           Find task by GitHub issue number
  --commit <sha>             Find task by commit SHA (prefix match)
  --json                     Output as JSON
  -h, --help                 Show this help message

${colors.bold}INDICATORS:${colors.reset}
  [B: xyz]                   Task is blocked by task xyz
  [B: 2]                     Task is blocked by 2 tasks

${colors.bold}EXAMPLES:${colors.reset}
  dex list                   # Show pending tasks as tree
  dex list abc123            # Show task abc123 and its subtree
  dex list "auth"            # Search for tasks containing "auth"
  dex list --all             # Include completed tasks
  dex list --completed       # Show only completed tasks
  dex list --ready           # Show tasks ready to work on
  dex list --blocked         # Show tasks waiting on dependencies
  dex list --issue 42        # Find task linked to GitHub issue #42
  dex list --commit abc123   # Find task linked to commit abc123
  dex list --json | jq '.'   # Output JSON for scripting
`);
    return;
  }

  // Handle positional filter argument
  const filterArg = positional[0];
  let parentFilter: string | undefined;
  let queryFilter: string | undefined;

  if (filterArg) {
    // Check if it looks like a task ID (8 lowercase alphanumeric chars)
    const isTaskId = /^[a-z0-9]{8}$/.test(filterArg);
    if (isTaskId) {
      parentFilter = filterArg;
    } else {
      queryFilter = filterArg;
    }
  }

  const completedFilter = getBooleanFlag(flags, "completed") ? true : undefined;

  const service = createService(options);

  // If parent filter specified, validate it exists
  if (parentFilter) {
    const parentTask = await service.get(parentFilter);
    if (!parentTask) {
      // Fall back to treating as query if not a valid task ID
      queryFilter = filterArg;
      parentFilter = undefined;
    }
  }

  // Merge query from positional arg or --query flag
  const query = queryFilter ?? getStringFlag(flags, "query");

  // Metadata filters
  const issueFilter = parseIntFlag(flags, "issue");
  const commitFilter = getStringFlag(flags, "commit");

  // When using metadata filters, always search all tasks
  const needsAllTasks = issueFilter !== undefined || commitFilter !== undefined;

  let tasks = await service.list({
    all: getBooleanFlag(flags, "all") || needsAllTasks || undefined,
    completed: needsAllTasks ? undefined : completedFilter,
    query,
    blocked: getBooleanFlag(flags, "blocked") || undefined,
    ready: getBooleanFlag(flags, "ready") || undefined,
  });

  // Filter by GitHub issue number
  if (issueFilter !== undefined) {
    tasks = tasks.filter((t) => getGitHubIssueNumber(t) === issueFilter);
  }

  // Filter by commit SHA (prefix match)
  if (commitFilter !== undefined) {
    const commitLower = commitFilter.toLowerCase();
    tasks = tasks.filter((t) => {
      const sha = t.metadata?.commit?.sha;
      return sha && sha.toLowerCase().startsWith(commitLower);
    });
  }

  // Get all tasks for blocker resolution (needed for display)
  const allTasks = await service.list({ all: true });

  // Filter to subtree if parent filter is active
  let filteredTasks = tasks;
  let subtreeRoot: Task | undefined;
  if (parentFilter) {
    const descendants = new Set<string>();
    collectSubtreeIds(tasks, parentFilter, descendants);
    // Include the root task itself
    filteredTasks = tasks.filter((t) => t.id === parentFilter || descendants.has(t.id));
    subtreeRoot = filteredTasks.find((t) => t.id === parentFilter);
  }

  // JSON output mode
  if (getBooleanFlag(flags, "json")) {
    console.log(JSON.stringify(filteredTasks, null, 2));
    return;
  }

  if (filteredTasks.length === 0) {
    console.log("No tasks found.");
    return;
  }

  // Show breadcrumb for subtree view
  if (subtreeRoot) {
    const ancestors = await service.getAncestors(subtreeRoot.id);
    if (ancestors.length > 0) {
      const breadcrumb = formatBreadcrumb(ancestors, subtreeRoot, 40);
      console.log(`${colors.dim}Path:${colors.reset} ${breadcrumb}`);
      console.log("");
    }
  }

  // Use flat mode when explicitly requested or when filtering (tree display doesn't work well with filtered results)
  const useFlat = getBooleanFlag(flags, "flat") || Boolean(query) ||
    getBooleanFlag(flags, "blocked") || getBooleanFlag(flags, "ready") ||
    issueFilter !== undefined || commitFilter !== undefined;

  if (useFlat) {
    for (const task of filteredTasks) {
      const blockedByIds = getIncompleteBlockerIds(allTasks, task);
      console.log(formatTask(task, { truncateDescription: LIST_DESCRIPTION_MAX_LENGTH, blockedByIds }));
    }
  } else if (subtreeRoot) {
    // Subtree view: show the root task, then its children as a tree
    const blockedByIds = getIncompleteBlockerIds(allTasks, subtreeRoot);
    console.log(formatTask(subtreeRoot, { truncateDescription: LIST_DESCRIPTION_MAX_LENGTH, blockedByIds }));
    printTaskTree(filteredTasks, allTasks, subtreeRoot.id, "", false);
  } else {
    // Full tree view: show all root-level tasks
    printTaskTree(filteredTasks, allTasks, null, "");
  }
}

/**
 * Collect all descendant task IDs under a parent.
 */
function collectSubtreeIds(tasks: Task[], parentId: string, result: Set<string>): void {
  for (const task of tasks) {
    if (task.parent_id === parentId && !result.has(task.id)) {
      result.add(task.id);
      collectSubtreeIds(tasks, task.id, result);
    }
  }
}
