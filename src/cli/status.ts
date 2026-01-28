import type { Task } from "../types.js";
import type { CliOptions } from "./utils.js";
import { ASCII_BANNER, createService } from "./utils.js";
import { colors } from "./colors.js";
import { getBooleanFlag, parseArgs } from "./args.js";
import { printGroupedTasks } from "./tree-display.js";
import {
  getIncompleteBlockerIds,
  hasIncompleteChildren,
  isInProgress,
} from "../core/task-relationships.js";

// Limits for displayed tasks in each section
const READY_LIMIT = 5;
const COMPLETED_LIMIT = 5;
const IN_PROGRESS_LIMIT = 5;

// Max description length for status view
const STATUS_DESCRIPTION_MAX_LENGTH = 50;

interface StatusStats {
  total: number;
  pending: number;
  completed: number;
  blocked: number;
  ready: number;
  inProgress: number;
}

interface StatusData {
  stats: StatusStats;
  inProgressTasks: Task[];
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

  // Partition pending tasks into in-progress, blocked, and ready
  const inProgressTasks: Task[] = [];
  const blockedTasks: Task[] = [];
  const readyTasks: Task[] = [];
  for (const task of pending) {
    const taskInProgress = isInProgress(task);
    const hasBlockers = getIncompleteBlockerIds(tasks, task).length > 0;
    const hasChildren = hasIncompleteChildren(tasks, task);

    if (taskInProgress) {
      // In-progress tasks go to their own section
      inProgressTasks.push(task);
    } else if (hasBlockers || hasChildren) {
      blockedTasks.push(task);
    } else {
      readyTasks.push(task);
    }
  }

  // Sort in-progress tasks by started_at (most recent first)
  // All in-progress tasks have started_at set (filtered above via isInProgress)
  inProgressTasks.sort(
    (a, b) =>
      new Date(b.started_at!).getTime() - new Date(a.started_at!).getTime(),
  );

  // Sort ready tasks by priority
  readyTasks.sort((a, b) => a.priority - b.priority);

  // Recently completed: sorted by completed_at descending
  const recentlyCompleted = completed
    .filter((t) => t.completed_at)
    .toSorted(
      (a, b) =>
        new Date(b.completed_at!).getTime() -
        new Date(a.completed_at!).getTime(),
    );

  return {
    stats: {
      total: tasks.length,
      pending: pending.length,
      completed: completed.length,
      blocked: blockedTasks.length,
      ready: readyTasks.length,
      inProgress: inProgressTasks.length,
    },
    inProgressTasks,
    readyTasks,
    blockedTasks,
    recentlyCompleted,
  };
}

export async function statusCommand(
  args: string[],
  options: CliOptions,
): Promise<void> {
  const { flags } = parseArgs(
    args,
    {
      json: { hasValue: false },
      help: { short: "h", hasValue: false },
    },
    "status",
  );

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex status${colors.reset} - Show task dashboard overview

${colors.bold}USAGE:${colors.reset}
  dex status [options]

${colors.bold}OPTIONS:${colors.reset}
  --json                     Output as JSON
  -h, --help                 Show this help message

${colors.bold}DESCRIPTION:${colors.reset}
  Shows a dashboard-style overview of your tasks including:
  • Statistics summary (total, pending, completed, in-progress, blocked, ready)
  • In-progress tasks (started but not completed)
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
    console.log(
      JSON.stringify(
        {
          stats: statusData.stats,
          inProgressTasks: statusData.inProgressTasks.slice(
            0,
            IN_PROGRESS_LIMIT,
          ),
          readyTasks: statusData.readyTasks.slice(0, READY_LIMIT),
          blockedTasks: statusData.blockedTasks,
          recentlyCompleted: statusData.recentlyCompleted.slice(
            0,
            COMPLETED_LIMIT,
          ),
        },
        null,
        2,
      ),
    );
    return;
  }

  // Empty state
  if (allTasks.length === 0) {
    console.log(
      'No tasks yet. Create one with: dex create "Task name" --description "Details"',
    );
    return;
  }

  const {
    stats,
    inProgressTasks,
    readyTasks,
    blockedTasks,
    recentlyCompleted,
  } = statusData;

  // ASCII art header
  console.log(`${colors.bold}${ASCII_BANNER}${colors.reset}`);
  console.log("");

  // Metric cards - big numbers with labels below, centered over each label
  const pct =
    stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0;

  // Helper to center a string within a width
  const center = (s: string, w: number) => {
    const pad = w - s.length;
    const left = Math.floor(pad / 2);
    return " ".repeat(left) + s + " ".repeat(pad - left);
  };

  // Column widths match label lengths: "complete"=8, "active"=6, "ready"=5, "blocked"=7
  const col1 = center(`${pct}%`, 8);
  const col2 = center(String(stats.inProgress), 6);
  const col3 = center(String(stats.ready), 5);
  const col4 = center(String(stats.blocked), 7);

  console.log(
    `${colors.green}${colors.bold}${col1}${colors.reset}   ${colors.blue}${colors.bold}${col2}${colors.reset}   ${colors.green}${colors.bold}${col3}${colors.reset}   ${colors.yellow}${col4}${colors.reset}`,
  );
  console.log(
    `${colors.dim}complete   active   ready   blocked${colors.reset}`,
  );

  // In Progress section
  if (inProgressTasks.length > 0) {
    console.log("");
    console.log(
      `${colors.bold}In Progress (${inProgressTasks.length})${colors.reset}`,
    );
    console.log(`${colors.dim}────────────────────${colors.reset}`);
    printGroupedTasks(inProgressTasks, allTasks, IN_PROGRESS_LIMIT, {
      truncateName: STATUS_DESCRIPTION_MAX_LENGTH,
    });
    if (inProgressTasks.length > IN_PROGRESS_LIMIT) {
      const remaining = inProgressTasks.length - IN_PROGRESS_LIMIT;
      console.log(
        `${colors.dim}... and ${remaining} more${colors.reset} ${colors.cyan}dex list --in-progress${colors.reset}`,
      );
    }
  }

  // Ready to Work section
  if (readyTasks.length > 0) {
    console.log("");
    console.log(
      `${colors.bold}Ready to Work (${readyTasks.length})${colors.reset}`,
    );
    console.log(`${colors.dim}────────────────────${colors.reset}`);
    printGroupedTasks(readyTasks, allTasks, READY_LIMIT, {
      truncateName: STATUS_DESCRIPTION_MAX_LENGTH,
    });
    if (readyTasks.length > READY_LIMIT) {
      const remaining = readyTasks.length - READY_LIMIT;
      console.log(
        `${colors.dim}... and ${remaining} more${colors.reset} ${colors.cyan}dex list --ready${colors.reset}`,
      );
    }
  }

  // Blocked section
  if (blockedTasks.length > 0) {
    console.log("");
    console.log(
      `${colors.bold}Blocked (${blockedTasks.length})${colors.reset}`,
    );
    console.log(`${colors.dim}────────────────────${colors.reset}`);
    printGroupedTasks(blockedTasks, allTasks, blockedTasks.length, {
      truncateName: STATUS_DESCRIPTION_MAX_LENGTH,
      getBlockedByIds: (task) => getIncompleteBlockerIds(allTasks, task),
    });
  }

  // Recently Completed section
  if (recentlyCompleted.length > 0) {
    console.log("");
    console.log(`${colors.bold}Recently Completed${colors.reset}`);
    console.log(`${colors.dim}────────────────────${colors.reset}`);
    printGroupedTasks(recentlyCompleted, allTasks, COMPLETED_LIMIT, {
      truncateName: STATUS_DESCRIPTION_MAX_LENGTH,
    });
  }
}
