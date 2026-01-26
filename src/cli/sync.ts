import {
  CliOptions,
  colors,
  createService,
  formatCliError,
  getBooleanFlag,
  parseArgs,
  truncateText,
} from "./utils.js";
import {
  createGitHubSyncServiceOrThrow,
  getGitHubIssueNumber,
  GitHubSyncService,
  SyncProgress,
  SyncResult,
} from "../core/github/index.js";
import { loadConfig } from "../core/config.js";
import { updateSyncState } from "../core/sync-state.js";
import { Task } from "../types.js";

export async function syncCommand(
  args: string[],
  options: CliOptions
): Promise<void> {
  const { positional, flags } = parseArgs(
    args,
    {
      "dry-run": { hasValue: false },
      help: { short: "h", hasValue: false },
    },
    "sync"
  );

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex sync${colors.reset} - Push tasks to GitHub Issues

${colors.bold}USAGE:${colors.reset}
  dex sync              # Sync all root tasks
  dex sync <task-id>    # Sync specific task
  dex sync --dry-run    # Preview without syncing

${colors.bold}ARGUMENTS:${colors.reset}
  <task-id>             Optional task ID to sync (syncs all if omitted)

${colors.bold}OPTIONS:${colors.reset}
  --dry-run             Show what would be synced without making changes
  -h, --help            Show this help message

${colors.bold}REQUIREMENTS:${colors.reset}
  - Git repository with GitHub remote
  - GITHUB_TOKEN environment variable

${colors.bold}EXAMPLE:${colors.reset}
  dex sync                    # Sync all tasks to GitHub
  dex sync abc123             # Sync specific task
  dex sync --dry-run          # Preview sync
`);
    return;
  }

  const taskId = positional[0];
  const dryRun = getBooleanFlag(flags, "dry-run");
  const config = loadConfig({ storagePath: options.storage.getIdentifier() });

  let syncService: GitHubSyncService;
  try {
    syncService = createGitHubSyncServiceOrThrow(config.sync?.github);
  } catch (err) {
    console.error(formatCliError(err));
    process.exit(1);
  }

  const service = createService(options);
  const repo = syncService.getRepo();

  try {
    if (taskId) {
      // Sync specific task
      const task = await service.get(taskId);
      if (!task) {
        console.error(
          `${colors.red}Error:${colors.reset} Task ${taskId} not found`
        );
        process.exit(1);
      }

      // Find root task if this is a subtask
      const rootTask = await findRootTask(service, task);

      if (dryRun) {
        const action = getGitHubIssueNumber(rootTask) ? "update" : "create";
        console.log(
          `Would sync to ${colors.cyan}${repo.owner}/${repo.repo}${colors.reset}:`
        );
        console.log(
          `  [${action}] ${colors.bold}${rootTask.id}${colors.reset}: ${rootTask.description}`
        );
        return;
      }

      const store = await options.storage.readAsync();
      const result = await syncService.syncTask(rootTask, store);

      // Save github metadata to task
      if (result) {
        await saveGithubMetadata(service, result);
      }

      // Update sync state timestamp
      updateSyncState(options.storage.getIdentifier(), { lastSync: new Date().toISOString() });

      console.log(
        `${colors.green}Synced${colors.reset} task ${colors.bold}${rootTask.id}${colors.reset} to ${colors.cyan}${repo.owner}/${repo.repo}${colors.reset}`
      );
      if (result) {
        console.log(`  ${colors.dim}${result.github.issueUrl}${colors.reset}`);
      }
    } else {
      // Sync all root tasks
      const allTasks = await service.list({ all: true });
      const rootTasks = allTasks.filter((t) => !t.parent_id);

      if (rootTasks.length === 0) {
        console.log("No tasks to sync.");
        return;
      }

      if (dryRun) {
        console.log(
          `Would sync ${rootTasks.length} task(s) to ${colors.cyan}${repo.owner}/${repo.repo}${colors.reset}:`
        );
        for (const task of rootTasks) {
          const action = getGitHubIssueNumber(task) ? "update" : "create";
          console.log(
            `  [${action}] ${colors.bold}${task.id}${colors.reset}: ${task.description}`
          );
        }
        return;
      }

      console.log(
        `Syncing ${rootTasks.length} task(s) to ${colors.cyan}${repo.owner}/${repo.repo}${colors.reset}...`
      );

      const store = await options.storage.readAsync();
      const isTTY = process.stdout.isTTY;

      // Progress callback for real-time output
      const onProgress = (progress: SyncProgress): void => {
        const { current, total, task, phase } = progress;
        const desc = truncateText(task.description, 50);
        const counter = `[${current}/${total}]`;

        // Clear line for TTY (in-place updates)
        if (isTTY) {
          process.stdout.write("\r\x1b[K");
        }

        switch (phase) {
          case "checking":
            if (isTTY) {
              process.stdout.write(
                `${colors.dim}${counter}${colors.reset} Checking ${colors.bold}${task.id}${colors.reset}: ${desc}`
              );
            }
            break;
          case "skipped":
            // Show skipped in dim for TTY, but skip entirely for non-TTY to reduce noise
            if (isTTY) {
              console.log(
                `${colors.dim}${counter} ∙ ${task.id}: ${desc}${colors.reset}`
              );
            }
            break;
          case "creating":
            // Always show creates
            if (isTTY) {
              process.stdout.write(
                `${colors.dim}${counter}${colors.reset} ${colors.green}+${colors.reset} ${colors.bold}${task.id}${colors.reset}: ${desc}`
              );
            } else {
              console.log(`${counter} + ${task.id}: ${desc}`);
            }
            break;
          case "updating":
            // Always show updates
            if (isTTY) {
              process.stdout.write(
                `${colors.dim}${counter}${colors.reset} ${colors.yellow}↻${colors.reset} ${colors.bold}${task.id}${colors.reset}: ${desc}`
              );
            } else {
              console.log(`${counter} ~ ${task.id}: ${desc}`);
            }
            break;
        }
      };

      const results = await syncService.syncAll(store, { onProgress });

      // Clear any remaining progress line
      if (isTTY) {
        process.stdout.write("\r\x1b[K");
      }

      // Save github metadata for all synced tasks (skip already-synced ones)
      for (const result of results) {
        if (!result.skipped) {
          await saveGithubMetadata(service, result);
        }
      }

      // Update sync state timestamp
      updateSyncState(options.storage.getIdentifier(), { lastSync: new Date().toISOString() });

      const created = results.filter((r) => r.created).length;
      const updated = results.filter((r) => !r.created && !r.skipped).length;
      const skipped = results.filter((r) => r.skipped).length;

      console.log(
        `${colors.green}Synced${colors.reset} ${rootTasks.length} task(s) to ${colors.cyan}${repo.owner}/${repo.repo}${colors.reset}`
      );
      const parts = [];
      if (created > 0) parts.push(`${created} created`);
      if (updated > 0) parts.push(`${updated} updated`);
      if (skipped > 0) parts.push(`${skipped} unchanged`);
      if (parts.length > 0) {
        console.log(`  (${parts.join(", ")})`);
      }
    }
  } catch (err) {
    console.error(formatCliError(err));
    process.exit(1);
  }
}

/**
 * Save github metadata to a task after syncing.
 */
async function saveGithubMetadata(
  service: ReturnType<typeof createService>,
  result: SyncResult
): Promise<void> {
  const task = await service.get(result.taskId);
  if (!task) return;

  // Merge with existing metadata
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
 * Find the root task (no parent) for a given task.
 */
async function findRootTask(
  service: ReturnType<typeof createService>,
  task: Task
): Promise<Task> {
  if (!task.parent_id) {
    return task;
  }
  const parent = await service.get(task.parent_id);
  if (!parent) {
    return task; // Orphaned subtask, treat as root
  }
  return findRootTask(service, parent);
}
