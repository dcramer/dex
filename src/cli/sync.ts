import type { CliOptions } from "./utils.js";
import { createService, findRootTask, formatCliError } from "./utils.js";
import { colors } from "./colors.js";
import { getBooleanFlag, parseArgs } from "./args.js";
import { truncateText } from "./formatting.js";
import type { Task } from "../types.js";
import type { SyncProgress } from "../core/sync/interface.js";
import type {
  RegisterableSyncService,
  SyncResult,
} from "../core/sync/registry.js";
import { GitHubSyncService } from "../core/github/index.js";
import { ShortcutSyncService } from "../core/shortcut/index.js";
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

  const service = createService(options);
  const registry = options.syncRegistry;

  // Determine which services to use based on flags
  const servicesToUse: RegisterableSyncService[] = [];

  if (githubOnly) {
    const githubService = registry?.get("github");
    if (!githubService) {
      console.error(
        `${colors.red}Error:${colors.reset} GitHub sync not available.\n` +
          "Ensure GITHUB_TOKEN is set and sync.github is configured in dex.toml.",
      );
      process.exit(1);
    }
    servicesToUse.push(githubService);
  } else if (shortcutOnly) {
    const shortcutService = registry?.get("shortcut");
    if (!shortcutService) {
      console.error(
        `${colors.red}Error:${colors.reset} Shortcut sync not available.\n` +
          "Ensure SHORTCUT_API_TOKEN is set and sync.shortcut is configured in dex.toml.",
      );
      process.exit(1);
    }
    servicesToUse.push(shortcutService);
  } else {
    // No flag specified - use all available services
    const allServices = registry?.getAll() ?? [];
    servicesToUse.push(...allServices);
  }

  // Check if we have at least one sync service
  if (servicesToUse.length === 0) {
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
        printDryRunSingleTask(rootTask, servicesToUse);
        return;
      }

      const store = await options.storage.readAsync();

      // Sync to each service
      for (const syncService of servicesToUse) {
        const result = await syncService.syncTask(rootTask, store);
        if (result) {
          await saveMetadata(service, syncService.id, result);
          const target = getServiceTarget(syncService);
          const url = getResultUrl(result);
          console.log(
            `${colors.green}Synced${colors.reset} task ${colors.bold}${rootTask.id}${colors.reset} to ${syncService.displayName} ${colors.cyan}${target}${colors.reset}`,
          );
          if (url) {
            console.log(`  ${colors.dim}${url}${colors.reset}`);
          }
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
        printDryRunAllTasks(rootTasks, servicesToUse);
        return;
      }

      const store = await options.storage.readAsync();

      // Sync to each service
      for (const syncService of servicesToUse) {
        const target = getServiceTarget(syncService);
        console.log(
          `Syncing ${rootTasks.length} task(s) to ${syncService.displayName} ${colors.cyan}${target}${colors.reset}...`,
        );

        const results = await syncAllWithProgress(syncService, store, service);
        printSyncSummary(syncService.displayName, target, results);
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
 * Get a display-friendly target string for a sync service.
 */
function getServiceTarget(syncService: RegisterableSyncService): string {
  if (syncService instanceof GitHubSyncService) {
    const repo = syncService.getRepo();
    return `${repo.owner}/${repo.repo}`;
  }
  if (syncService instanceof ShortcutSyncService) {
    return syncService.getWorkspace();
  }
  return syncService.id;
}

/**
 * Extract URL from a sync result.
 */
function getResultUrl(result: SyncResult): string | null {
  const meta = result.metadata as { issueUrl?: string; storyUrl?: string };
  return meta.issueUrl ?? meta.storyUrl ?? null;
}

/**
 * Check if a task has a remote ID for the given sync service.
 */
function hasRemoteId(
  syncService: RegisterableSyncService,
  task: Task,
): boolean {
  if (
    "getRemoteId" in syncService &&
    typeof syncService.getRemoteId === "function"
  ) {
    return syncService.getRemoteId(task) !== null;
  }
  return false;
}

/**
 * Print dry run output for a single task.
 */
function printDryRunSingleTask(
  task: Task,
  services: RegisterableSyncService[],
): void {
  for (const syncService of services) {
    const target = getServiceTarget(syncService);
    const action = hasRemoteId(syncService, task) ? "update" : "create";
    console.log(
      `Would sync to ${syncService.displayName} ${colors.cyan}${target}${colors.reset}:`,
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
  services: RegisterableSyncService[],
): void {
  for (const syncService of services) {
    const target = getServiceTarget(syncService);
    console.log(
      `Would sync ${tasks.length} task(s) to ${syncService.displayName} ${colors.cyan}${target}${colors.reset}:`,
    );
    for (const task of tasks) {
      const action = hasRemoteId(syncService, task) ? "update" : "create";
      console.log(
        `  [${action}] ${colors.bold}${task.id}${colors.reset}: ${task.name}`,
      );
    }
  }
}

/**
 * Sync all tasks to a service with progress output.
 */
async function syncAllWithProgress(
  syncService: RegisterableSyncService,
  store: { tasks: Task[] },
  service: ReturnType<typeof createService>,
): Promise<SyncResult[]> {
  const isTTY = process.stdout.isTTY;

  const onProgress = (progress: SyncProgress): void => {
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
      await saveMetadata(service, syncService.id, result);
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
 * Save metadata to a task after syncing.
 */
async function saveMetadata(
  service: ReturnType<typeof createService>,
  integrationId: string,
  result: SyncResult,
): Promise<void> {
  const task = await service.get(result.taskId);
  if (!task) return;

  const metadata = {
    ...task.metadata,
    [integrationId]: result.metadata,
  };

  await service.update({
    id: result.taskId,
    metadata,
  });

  // Handle subtask results for integrations that support them (like Shortcut)
  if (result.subtaskResults) {
    for (const subtaskResult of result.subtaskResults) {
      await saveMetadata(service, integrationId, subtaskResult);
    }
  }
}
