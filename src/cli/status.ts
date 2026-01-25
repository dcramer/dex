import { Task } from "../types.js";
import {
  ASCII_BANNER,
  CliOptions,
  colors,
  createService,
  formatTask,
  getBooleanFlag,
  getIncompleteBlockerIds,
  hasIncompleteChildren,
  parseArgs,
  truncateText,
} from "./utils.js";

// Limits for displayed tasks in each section
const READY_LIMIT = 5;
const COMPLETED_LIMIT = 5;

// Max description length for status view
const STATUS_DESCRIPTION_MAX_LENGTH = 50;

interface PrintContext {
  childrenMap: Map<string, Task[]>;
  allTasks: Task[];
  printed: Set<string>;
  count: number;
  limit: number;
  getBlockedByIds?: (task: Task) => string[];
}

/**
 * Build a map of parent ID to children that are in the section.
 */
function buildChildrenMap(sectionTasks: Task[]): Map<string, Task[]> {
  const map = new Map<string, Task[]>();
  for (const task of sectionTasks) {
    if (task.parent_id) {
      if (!map.has(task.parent_id)) {
        map.set(task.parent_id, []);
      }
      map.get(task.parent_id)!.push(task);
    }
  }
  // Sort children by priority within each group
  for (const children of map.values()) {
    children.sort((a, b) => a.priority - b.priority);
  }
  return map;
}

/**
 * Calculate the continuation prefix for nested children.
 * Converts tree connectors to vertical lines or spaces for proper alignment.
 */
function getContinuationPrefix(prefix: string): string {
  return prefix.replace(/├── $/, "│   ").replace(/└── $/, "    ");
}

/**
 * Print a task and recursively print its children that are in the section.
 */
function printTaskWithChildren(
  task: Task,
  ctx: PrintContext,
  prefix: string
): void {
  if (ctx.count >= ctx.limit || ctx.printed.has(task.id)) return;

  const blockedByIds = ctx.getBlockedByIds?.(task) || [];

  console.log(formatTask(task, {
    treePrefix: prefix,
    truncateDescription: STATUS_DESCRIPTION_MAX_LENGTH,
    blockedByIds,
  }));
  ctx.printed.add(task.id);
  ctx.count++;

  // Print children that are in the section
  const children = (ctx.childrenMap.get(task.id) || []).filter((c) => !ctx.printed.has(c.id));

  for (let i = 0; i < children.length && ctx.count < ctx.limit; i++) {
    const isLast = i === children.length - 1 || ctx.count + 1 >= ctx.limit;
    const connector = isLast ? "└── " : "├── ";
    const childPrefix = getContinuationPrefix(prefix) + connector;

    printTaskWithChildren(children[i], ctx, childPrefix);
  }
}

/**
 * Print tasks grouped by parent with tree connectors.
 * Tasks with children in the section show those children nested underneath.
 * Tasks whose parent is not in the section show a dimmed parent header.
 */
function printGroupedTasks(
  sectionTasks: Task[],
  allTasks: Task[],
  limit: number,
  options: { blockedByIds?: (task: Task) => string[] } = {}
): void {
  const sectionTaskIds = new Set(sectionTasks.map((t) => t.id));
  const childrenMap = buildChildrenMap(sectionTasks);

  const ctx: PrintContext = {
    childrenMap,
    allTasks,
    printed: new Set<string>(),
    count: 0,
    limit,
    getBlockedByIds: options.blockedByIds,
  };

  // Separate tasks into root tasks and orphans (tasks whose parent is not in section)
  const rootTasks: Task[] = [];
  const orphansByParent = new Map<string, Task[]>();

  for (const task of sectionTasks) {
    if (!task.parent_id) {
      rootTasks.push(task);
    } else if (!sectionTaskIds.has(task.parent_id)) {
      // Parent exists but not in section - group under parent
      const siblings = orphansByParent.get(task.parent_id) || [];
      siblings.push(task);
      orphansByParent.set(task.parent_id, siblings);
    }
    // Tasks with parent in section will be printed as children
  }

  // Sort root tasks by priority and print them
  rootTasks.sort((a, b) => a.priority - b.priority);
  for (const task of rootTasks) {
    if (ctx.count >= limit) break;
    printTaskWithChildren(task, ctx, "");
  }

  // Print orphan groups with dimmed parent headers
  for (const [parentId, children] of orphansByParent) {
    if (ctx.count >= limit) break;

    children.sort((a, b) => a.priority - b.priority);
    const remainingChildren = children.filter((c) => !ctx.printed.has(c.id));
    if (remainingChildren.length === 0) continue;

    // Show dimmed parent header
    const parent = allTasks.find((t) => t.id === parentId);
    if (parent) {
      const parentDesc = truncateText(parent.description, STATUS_DESCRIPTION_MAX_LENGTH);
      const parentIcon = parent.completed ? "[x]" : "[ ]";
      console.log(`${colors.dim}${parentIcon} ${parent.id}: ${parentDesc}${colors.reset}`);
    }

    // Print children with tree connectors
    for (let i = 0; i < remainingChildren.length && ctx.count < limit; i++) {
      const isLast = i === remainingChildren.length - 1 || ctx.count + 1 >= limit;
      const connector = isLast ? "└── " : "├── ";
      printTaskWithChildren(remainingChildren[i], ctx, connector);
    }
  }
}

interface StatusStats {
  total: number;
  pending: number;
  completed: number;
  blocked: number;
  ready: number;
}

interface StatusData {
  stats: StatusStats;
  readyTasks: Task[];
  blockedTasks: Task[];
  recentlyCompleted: Task[];
}

/**
 * Calculate status statistics and categorized task lists.
 */
function calculateStatus(tasks: Task[]): StatusData {
  const pending = tasks.filter((t) => !t.completed);
  const completed = tasks.filter((t) => t.completed);

  // Partition pending tasks into blocked and ready (single pass)
  // A task is ready only if it has no incomplete blockers AND no incomplete children
  const blockedTasks: Task[] = [];
  const readyTasks: Task[] = [];
  for (const task of pending) {
    const hasBlockers = getIncompleteBlockerIds(tasks, task).length > 0;
    const hasChildren = hasIncompleteChildren(tasks, task);
    if (hasBlockers || hasChildren) {
      blockedTasks.push(task);
    } else {
      readyTasks.push(task);
    }
  }

  // Sort ready tasks by priority
  readyTasks.sort((a, b) => a.priority - b.priority);

  // Recently completed: sorted by completed_at descending
  const recentlyCompleted = completed
    .filter((t) => t.completed_at)
    .toSorted((a, b) => new Date(b.completed_at!).getTime() - new Date(a.completed_at!).getTime());

  return {
    stats: {
      total: tasks.length,
      pending: pending.length,
      completed: completed.length,
      blocked: blockedTasks.length,
      ready: readyTasks.length,
    },
    readyTasks,
    blockedTasks,
    recentlyCompleted,
  };
}

export async function statusCommand(args: string[], options: CliOptions): Promise<void> {
  const { flags } = parseArgs(args, {
    json: { hasValue: false },
    help: { short: "h", hasValue: false },
  }, "status");

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex status${colors.reset} - Show task dashboard overview

${colors.bold}USAGE:${colors.reset}
  dex status [options]

${colors.bold}OPTIONS:${colors.reset}
  --json                     Output as JSON
  -h, --help                 Show this help message

${colors.bold}DESCRIPTION:${colors.reset}
  Shows a dashboard-style overview of your tasks including:
  • Statistics summary (total, pending, completed, blocked, ready)
  • Tasks ready to work on (pending with no blockers)
  • Blocked tasks (waiting on dependencies)
  • Recently completed tasks

${colors.bold}EXAMPLES:${colors.reset}
  dex status                 # Show dashboard
  dex status --json          # Output as JSON for scripting
`);
    return;
  }

  const service = createService(options);
  const allTasks = await service.list({ all: true });
  const statusData = calculateStatus(allTasks);

  // JSON output mode
  if (getBooleanFlag(flags, "json")) {
    console.log(JSON.stringify({
      stats: statusData.stats,
      readyTasks: statusData.readyTasks.slice(0, READY_LIMIT),
      blockedTasks: statusData.blockedTasks,
      recentlyCompleted: statusData.recentlyCompleted.slice(0, COMPLETED_LIMIT),
    }, null, 2));
    return;
  }

  // Empty state
  if (allTasks.length === 0) {
    console.log("No tasks yet. Create one with: dex create -d \"Description\" --context \"Details\"");
    return;
  }

  const { stats, readyTasks, blockedTasks, recentlyCompleted } = statusData;

  // ASCII art header
  console.log(`${colors.bold}${ASCII_BANNER}${colors.reset}`);
  console.log("");

  // Metric cards - big numbers with labels below, centered over each label
  const pct = stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

  // Helper to center a string within a width
  const center = (s: string, w: number) => {
    const pad = w - s.length;
    const left = Math.floor(pad / 2);
    return " ".repeat(left) + s + " ".repeat(pad - left);
  };

  // Column widths match label lengths: "complete"=8, "ready"=5, "blocked"=7
  const col1 = center(`${pct}%`, 8);
  const col2 = center(String(stats.ready), 5);
  const col3 = center(String(stats.blocked), 7);

  console.log(`${colors.green}${colors.bold}${col1}${colors.reset}   ${colors.green}${colors.bold}${col2}${colors.reset}   ${colors.yellow}${col3}${colors.reset}`);
  console.log(`${colors.dim}complete   ready   blocked${colors.reset}`);

  // Ready to Work section
  if (readyTasks.length > 0) {
    console.log("");
    console.log(`${colors.bold}Ready to Work (${readyTasks.length})${colors.reset}`);
    console.log(`${colors.dim}────────────────────${colors.reset}`);
    printGroupedTasks(readyTasks, allTasks, READY_LIMIT);
    if (readyTasks.length > READY_LIMIT) {
      const remaining = readyTasks.length - READY_LIMIT;
      console.log(`${colors.dim}... and ${remaining} more (dex list --ready)${colors.reset}`);
    }
  }

  // Blocked section
  if (blockedTasks.length > 0) {
    console.log("");
    console.log(`${colors.bold}Blocked (${blockedTasks.length})${colors.reset}`);
    console.log(`${colors.dim}────────────────────${colors.reset}`);
    printGroupedTasks(blockedTasks, allTasks, blockedTasks.length, {
      blockedByIds: (task) => getIncompleteBlockerIds(allTasks, task),
    });
  }

  // Recently Completed section
  if (recentlyCompleted.length > 0) {
    console.log("");
    console.log(`${colors.bold}Recently Completed${colors.reset}`);
    console.log(`${colors.dim}────────────────────${colors.reset}`);
    printGroupedTasks(recentlyCompleted, allTasks, COMPLETED_LIMIT);
  }
}
