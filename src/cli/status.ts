import { Task } from "../types.js";
import {
  CliOptions,
  colors,
  createService,
  formatTask,
  getBooleanFlag,
  getIncompleteBlockerIds,
  parseArgs,
  pluralize,
} from "./utils.js";

// Limits for displayed tasks in each section
const READY_LIMIT = 5;
const COMPLETED_LIMIT = 5;

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
  const blockedTasks: Task[] = [];
  const readyTasks: Task[] = [];
  for (const task of pending) {
    if (getIncompleteBlockerIds(tasks, task).length > 0) {
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
  console.log(`${colors.bold} ___  ___ _  _`);
  console.log(`|   \\| __\\ \\/ /`);
  console.log(`| |) | _| >  < `);
  console.log(`|___/|___|_/\\_\\${colors.reset}`);
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
    const displayReady = readyTasks.slice(0, READY_LIMIT);
    for (const task of displayReady) {
      console.log(formatTask(task, { truncateDescription: 50 }));
    }
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
    for (const task of blockedTasks) {
      const blockerIds = getIncompleteBlockerIds(allTasks, task);
      console.log(formatTask(task, { truncateDescription: 50, blockedByIds: blockerIds }));
    }
  }

  // Recently Completed section
  if (recentlyCompleted.length > 0) {
    console.log("");
    console.log(`${colors.bold}Recently Completed${colors.reset}`);
    console.log(`${colors.dim}────────────────────${colors.reset}`);
    const displayCompleted = recentlyCompleted.slice(0, COMPLETED_LIMIT);
    for (const task of displayCompleted) {
      console.log(formatTask(task, { truncateDescription: 50 }));
    }
  }
}
