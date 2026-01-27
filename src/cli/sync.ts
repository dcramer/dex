import type { CliOptions } from "./utils.js";
import { createService, findRootTask, formatCliError } from "./utils.js";
import { colors } from "./colors.js";
import { getBooleanFlag, parseArgs } from "./args.js";
import { truncateText } from "./formatting.js";
import type { Task } from "../types.js";
import type {
  SyncProgress as GitHubSyncProgress,
  SyncResult as GitHubSyncResult,
} from "../core/github/index.js";
import {
  createGitHubSyncServiceOrThrow,
  getGitHubIssueNumber,
  GitHubSyncService,
} from "../core/github/index.js";
import type {
  SyncProgress as ShortcutSyncProgress,
  SyncResult as ShortcutSyncResult,
} from "../core/shortcut/index.js";
import {
  createShortcutSyncServiceOrThrow,
  getShortcutStoryId,
  ShortcutSyncService,
} from "../core/shortcut/index.js";
import { loadConfig } from "../core/config.js";
import { updateSyncState } from "../core/sync-state.js";

export async function syncCommand(
  args: string[],
  options: CliOptions,
): Promise<void> {
  const { positional, flags } = parseArgs(
    args,
    {
      "dry-run": { hasValue: false },
      github: { hasValue: false },
      shortcut: { hasValue: false },
      help: { short: "h", hasValue: false },
    },
    "sync",
  );

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex sync${colors.reset} - Push tasks to GitHub Issues or Shortcut Stories

${colors.bold}USAGE:${colors.reset}
  dex sync              # Sync all root tasks to all enabled services
  dex sync <task-id>    # Sync specific task
  dex sync --github     # Sync only to GitHub
  dex sync --shortcut   # Sync only to Shortcut
  dex sync --dry-run    # Preview without syncing

${colors.bold}ARGUMENTS:${colors.reset}
  <task-id>             Optional task ID to sync (syncs all if omitted)

${colors.bold}OPTIONS:${colors.reset}
  --github              Sync only to GitHub Issues
  --shortcut            Sync only to Shortcut Stories
  --dry-run             Show what would be synced without making changes
  -h, --help            Show this help message

${colors.bold}REQUIREMENTS:${colors.reset}
  GitHub:
    - Git repository with GitHub remote
    - GITHUB_TOKEN environment variable

  Shortcut:
    - SHORTCUT_API_TOKEN environment variable
    - Team configured in dex.toml [sync.shortcut] section

${colors.bold}EXAMPLE:${colors.reset}
  dex sync                    # Sync all tasks to all services
  dex sync abc123             # Sync specific task
  dex sync --github           # Sync only to GitHub
  dex sync --shortcut         # Sync only to Shortcut
  dex sync --dry-run          # Preview sync
`);
    return;
  }

  const taskId = positional[0];
  const dryRun = getBooleanFlag(flags, "dry-run");
  const githubOnly = getBooleanFlag(flags, "github");
  const shortcutOnly = getBooleanFlag(flags, "shortcut");

  // If neither flag is specified, sync to all configured services
  const syncToGitHub = !shortcutOnly;
  const syncToShortcut = !githubOnly;

  const config = loadConfig({ storagePath: options.storage.getIdentifier() });
  const service = createService(options);

  let githubSyncService: GitHubSyncService | null = null;
  let shortcutSyncService: ShortcutSyncService | null = null;

  // Try to create GitHub sync service
  if (syncToGitHub) {
    try {
      githubSyncService = createGitHubSyncServiceOrThrow(config.sync?.github);
    } catch (err) {
      if (githubOnly) {
        // If explicitly requested, show the error
        console.error(formatCliError(err));
        process.exit(1);
      }
      // Otherwise, silently skip GitHub sync
    }
  }

  // Try to create Shortcut sync service
  if (syncToShortcut) {
    try {
      shortcutSyncService = await createShortcutSyncServiceOrThrow(
        config.sync?.shortcut,
      );
    } catch (err) {
      if (shortcutOnly) {
        // If explicitly requested, show the error
        console.error(formatCliError(err));
        process.exit(1);
      }
      // Otherwise, silently skip Shortcut sync
    }
  }

  // Check if we have at least one sync service
  if (!githubSyncService && !shortcutSyncService) {
    console.error(
      `${colors.red}Error:${colors.reset} No sync services available.\n` +
        "Configure GitHub and/or Shortcut sync in dex.toml.",
    );
    process.exit(1);
  }

  try {
    if (taskId) {
      // Sync specific task
      const task = await service.get(taskId);
      if (!task) {
        console.error(
          `${colors.red}Error:${colors.reset} Task ${taskId} not found`,
        );
        process.exit(1);
      }

      // Find root task if this is a subtask
      const rootTask = await findRootTask(service, task);

      if (dryRun) {
        printDryRunSingleTask(rootTask, githubSyncService, shortcutSyncService);
        return;
      }

      const store = await options.storage.readAsync();

      // Sync to GitHub
      if (githubSyncService) {
        const result = await githubSyncService.syncTask(rootTask, store);
        if (result) {
          await saveGithubMetadata(service, result);
          const repo = githubSyncService.getRepo();
          console.log(
            `${colors.green}Synced${colors.reset} task ${colors.bold}${rootTask.id}${colors.reset} to GitHub ${colors.cyan}${repo.owner}/${repo.repo}${colors.reset}`,
          );
          console.log(
            `  ${colors.dim}${result.github.issueUrl}${colors.reset}`,
          );
        }
      }

      // Sync to Shortcut
      if (shortcutSyncService) {
        const result = await shortcutSyncService.syncTask(rootTask, store);
        if (result) {
          await saveShortcutMetadata(service, result);
          const workspace = shortcutSyncService.getWorkspace();
          console.log(
            `${colors.green}Synced${colors.reset} task ${colors.bold}${rootTask.id}${colors.reset} to Shortcut ${colors.cyan}${workspace}${colors.reset}`,
          );
          console.log(
            `  ${colors.dim}${result.shortcut.storyUrl}${colors.reset}`,
          );
        }
      }

      // Update sync state timestamp
      updateSyncState(options.storage.getIdentifier(), {
        lastSync: new Date().toISOString(),
      });
    } else {
      // Sync all root tasks
      const allTasks = await service.list({ all: true });
      const rootTasks = allTasks.filter((t) => !t.parent_id);

      if (rootTasks.length === 0) {
        console.log("No tasks to sync.");
        return;
      }

      if (dryRun) {
        printDryRunAllTasks(rootTasks, githubSyncService, shortcutSyncService);
        return;
      }

      const store = await options.storage.readAsync();

      // Sync to GitHub
      if (githubSyncService) {
        const repo = githubSyncService.getRepo();
        console.log(
          `Syncing ${rootTasks.length} task(s) to GitHub ${colors.cyan}${repo.owner}/${repo.repo}${colors.reset}...`,
        );

        const results = await syncAllToGitHub(
          githubSyncService,
          store,
          service,
        );
        printSyncSummary("GitHub", repo.owner + "/" + repo.repo, results);
      }

      // Sync to Shortcut
      if (shortcutSyncService) {
        const workspace = shortcutSyncService.getWorkspace();
        console.log(
          `Syncing ${rootTasks.length} task(s) to Shortcut ${colors.cyan}${workspace}${colors.reset}...`,
        );

        const results = await syncAllToShortcut(
          shortcutSyncService,
          store,
          service,
        );
        printSyncSummary("Shortcut", workspace, results);
      }

      // Update sync state timestamp
      updateSyncState(options.storage.getIdentifier(), {
        lastSync: new Date().toISOString(),
      });
    }
  } catch (err) {
    console.error(formatCliError(err));
    process.exit(1);
  }
}

/**
 * Print dry run output for a single task.
 */
function printDryRunSingleTask(
  task: Task,
  githubService: GitHubSyncService | null,
  shortcutService: ShortcutSyncService | null,
): void {
  if (githubService) {
    const repo = githubService.getRepo();
    const action = getGitHubIssueNumber(task) ? "update" : "create";
    console.log(
      `Would sync to GitHub ${colors.cyan}${repo.owner}/${repo.repo}${colors.reset}:`,
    );
    console.log(
      `  [${action}] ${colors.bold}${task.id}${colors.reset}: ${task.name}`,
    );
  }

  if (shortcutService) {
    const workspace = shortcutService.getWorkspace();
    const action = getShortcutStoryId(task) ? "update" : "create";
    console.log(
      `Would sync to Shortcut ${colors.cyan}${workspace}${colors.reset}:`,
    );
    console.log(
      `  [${action}] ${colors.bold}${task.id}${colors.reset}: ${task.name}`,
    );
  }
}

/**
 * Print dry run output for all tasks.
 */
function printDryRunAllTasks(
  tasks: Task[],
  githubService: GitHubSyncService | null,
  shortcutService: ShortcutSyncService | null,
): void {
  if (githubService) {
    const repo = githubService.getRepo();
    console.log(
      `Would sync ${tasks.length} task(s) to GitHub ${colors.cyan}${repo.owner}/${repo.repo}${colors.reset}:`,
    );
    for (const task of tasks) {
      const action = getGitHubIssueNumber(task) ? "update" : "create";
      console.log(
        `  [${action}] ${colors.bold}${task.id}${colors.reset}: ${task.name}`,
      );
    }
  }

  if (shortcutService) {
    const workspace = shortcutService.getWorkspace();
    console.log(
      `Would sync ${tasks.length} task(s) to Shortcut ${colors.cyan}${workspace}${colors.reset}:`,
    );
    for (const task of tasks) {
      const action = getShortcutStoryId(task) ? "update" : "create";
      console.log(
        `  [${action}] ${colors.bold}${task.id}${colors.reset}: ${task.name}`,
      );
    }
  }
}

/**
 * Sync all tasks to GitHub with progress output.
 */
async function syncAllToGitHub(
  syncService: GitHubSyncService,
  store: { tasks: Task[] },
  service: ReturnType<typeof createService>,
): Promise<GitHubSyncResult[]> {
  const isTTY = process.stdout.isTTY;

  const onProgress = (progress: GitHubSyncProgress): void => {
    const { current, total, task, phase } = progress;
    const desc = truncateText(task.name, 50);
    const counter = `[${current}/${total}]`;

    if (isTTY) {
      process.stdout.write("\r\x1b[K");
    }

    switch (phase) {
      case "checking":
        if (isTTY) {
          process.stdout.write(
            `${colors.dim}${counter}${colors.reset} Checking ${colors.bold}${task.id}${colors.reset}: ${desc}`,
          );
        }
        break;
      case "skipped":
        if (isTTY) {
          console.log(
            `${colors.dim}${counter} ∙ ${task.id}: ${desc}${colors.reset}`,
          );
        }
        break;
      case "creating":
        if (isTTY) {
          process.stdout.write(
            `${colors.dim}${counter}${colors.reset} ${colors.green}+${colors.reset} ${colors.bold}${task.id}${colors.reset}: ${desc}`,
          );
        } else {
          console.log(`${counter} + ${task.id}: ${desc}`);
        }
        break;
      case "updating":
        if (isTTY) {
          process.stdout.write(
            `${colors.dim}${counter}${colors.reset} ${colors.yellow}↻${colors.reset} ${colors.bold}${task.id}${colors.reset}: ${desc}`,
          );
        } else {
          console.log(`${counter} ~ ${task.id}: ${desc}`);
        }
        break;
    }
  };

  const results = await syncService.syncAll(store, { onProgress });

  if (isTTY) {
    process.stdout.write("\r\x1b[K");
  }

  // Save metadata for all synced tasks
  for (const result of results) {
    if (!result.skipped) {
      await saveGithubMetadata(service, result);
    }
  }

  return results;
}

/**
 * Sync all tasks to Shortcut with progress output.
 */
async function syncAllToShortcut(
  syncService: ShortcutSyncService,
  store: { tasks: Task[] },
  service: ReturnType<typeof createService>,
): Promise<ShortcutSyncResult[]> {
  const isTTY = process.stdout.isTTY;

  const onProgress = (progress: ShortcutSyncProgress): void => {
    const { current, total, task, phase } = progress;
    const desc = truncateText(task.name, 50);
    const counter = `[${current}/${total}]`;

    if (isTTY) {
      process.stdout.write("\r\x1b[K");
    }

    switch (phase) {
      case "checking":
        if (isTTY) {
          process.stdout.write(
            `${colors.dim}${counter}${colors.reset} Checking ${colors.bold}${task.id}${colors.reset}: ${desc}`,
          );
        }
        break;
      case "skipped":
        if (isTTY) {
          console.log(
            `${colors.dim}${counter} ∙ ${task.id}: ${desc}${colors.reset}`,
          );
        }
        break;
      case "creating":
        if (isTTY) {
          process.stdout.write(
            `${colors.dim}${counter}${colors.reset} ${colors.green}+${colors.reset} ${colors.bold}${task.id}${colors.reset}: ${desc}`,
          );
        } else {
          console.log(`${counter} + ${task.id}: ${desc}`);
        }
        break;
      case "updating":
        if (isTTY) {
          process.stdout.write(
            `${colors.dim}${counter}${colors.reset} ${colors.yellow}↻${colors.reset} ${colors.bold}${task.id}${colors.reset}: ${desc}`,
          );
        } else {
          console.log(`${counter} ~ ${task.id}: ${desc}`);
        }
        break;
    }
  };

  const results = await syncService.syncAll(store, { onProgress });

  if (isTTY) {
    process.stdout.write("\r\x1b[K");
  }

  // Save metadata for all synced tasks
  for (const result of results) {
    if (!result.skipped) {
      await saveShortcutMetadata(service, result);
    }
  }

  return results;
}

/**
 * Print sync summary.
 */
function printSyncSummary(
  serviceName: string,
  target: string,
  results: Array<{ created: boolean; skipped?: boolean }>,
): void {
  const created = results.filter((r) => r.created).length;
  const updated = results.filter((r) => !r.created && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;

  console.log(
    `${colors.green}Synced${colors.reset} to ${serviceName} ${colors.cyan}${target}${colors.reset}`,
  );
  const parts = [];
  if (created > 0) parts.push(`${created} created`);
  if (updated > 0) parts.push(`${updated} updated`);
  if (skipped > 0) parts.push(`${skipped} unchanged`);
  if (parts.length > 0) {
    console.log(`  (${parts.join(", ")})`);
  }
}

/**
 * Save github metadata to a task after syncing.
 */
async function saveGithubMetadata(
  service: ReturnType<typeof createService>,
  result: GitHubSyncResult,
): Promise<void> {
  const task = await service.get(result.taskId);
  if (!task) return;

  const metadata = {
    ...task.metadata,
    github: result.github,
  };

  await service.update({
    id: result.taskId,
    metadata,
  });
}

/**
 * Save shortcut metadata to a task after syncing.
 */
async function saveShortcutMetadata(
  service: ReturnType<typeof createService>,
  result: ShortcutSyncResult,
): Promise<void> {
  const task = await service.get(result.taskId);
  if (!task) return;

  const metadata = {
    ...task.metadata,
    shortcut: result.shortcut,
  };

  await service.update({
    id: result.taskId,
    metadata,
  });
}
