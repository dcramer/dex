import { Task } from "../types.js";
import { colors } from "./colors.js";
import { formatTask, truncateText } from "./formatting.js";

export interface TreeDisplayOptions {
  /** Maximum length to truncate task names */
  truncateName?: number;
  /** Function to get blocker IDs for a task */
  getBlockedByIds?: (task: Task) => string[];
  /** Function to get GitHub issue for a task */
  getGithubIssue?: (task: Task) => number | undefined;
}

interface PrintContext {
  childrenMap: Map<string, Task[]>;
  printed: Set<string>;
  count: number;
  limit: number;
  options: TreeDisplayOptions;
}

/**
 * Build a map of parent ID to children that are in the section.
 */
export function buildChildrenMap(sectionTasks: Task[]): Map<string, Task[]> {
  const map = new Map<string, Task[]>();
  for (const task of sectionTasks) {
    if (!task.parent_id) continue;

    const siblings = map.get(task.parent_id);
    if (siblings) {
      siblings.push(task);
    } else {
      map.set(task.parent_id, [task]);
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
export function getContinuationPrefix(prefix: string): string {
  return prefix.replace(/├── $/, "│   ").replace(/└── $/, "    ");
}

/**
 * Print a task and recursively print its children that are in the section.
 */
function printTaskWithChildren(
  task: Task,
  ctx: PrintContext,
  prefix: string,
): void {
  if (ctx.count >= ctx.limit || ctx.printed.has(task.id)) return;

  const blockedByIds = ctx.options.getBlockedByIds?.(task) || [];
  const githubIssue = ctx.options.getGithubIssue?.(task);

  console.log(
    formatTask(task, {
      treePrefix: prefix,
      truncateName: ctx.options.truncateName,
      blockedByIds,
      githubIssue,
    }),
  );
  ctx.printed.add(task.id);
  ctx.count++;

  // Print children that are in the section
  const children = (ctx.childrenMap.get(task.id) || []).filter(
    (c) => !ctx.printed.has(c.id),
  );

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
export function printGroupedTasks(
  sectionTasks: Task[],
  allTasks: Task[],
  limit: number,
  options: TreeDisplayOptions = {},
): void {
  const sectionTaskIds = new Set(sectionTasks.map((t) => t.id));
  const childrenMap = buildChildrenMap(sectionTasks);

  const ctx: PrintContext = {
    childrenMap,
    printed: new Set<string>(),
    count: 0,
    limit,
    options,
  };

  // Separate tasks into root tasks and orphans (tasks whose parent is not in section)
  const rootTasks: Task[] = [];
  const orphansByParent = new Map<string, Task[]>();

  for (const task of sectionTasks) {
    if (!task.parent_id) {
      rootTasks.push(task);
      continue;
    }
    if (sectionTaskIds.has(task.parent_id)) {
      // Tasks with parent in section will be printed as children
      continue;
    }
    // Parent exists but not in section - group under parent
    const siblings = orphansByParent.get(task.parent_id);
    if (siblings) {
      siblings.push(task);
    } else {
      orphansByParent.set(task.parent_id, [task]);
    }
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
      const parentName = truncateText(parent.name, options.truncateName ?? 50);
      const parentIcon = parent.completed ? "[x]" : "[ ]";
      console.log(
        `${colors.dim}${parentIcon} ${parent.id}: ${parentName}${colors.reset}`,
      );
    }

    // Print children with tree connectors
    for (let i = 0; i < remainingChildren.length && ctx.count < limit; i++) {
      const isLast =
        i === remainingChildren.length - 1 || ctx.count + 1 >= limit;
      const connector = isLast ? "└── " : "├── ";
      printTaskWithChildren(remainingChildren[i], ctx, connector);
    }
  }
}
