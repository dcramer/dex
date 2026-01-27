import {
  CliOptions,
  createService,
  findRootTask,
  formatCliError,
} from "./utils.js";
import { colors } from "./colors.js";
import { getBooleanFlag, parseArgs } from "./args.js";
import {
  createGitHubSyncServiceOrThrow,
  getGitHubIssueNumber,
  GitHubSyncService,
} from "../core/github/index.js";
import { loadConfig } from "../core/config.js";

export async function exportCommand(
  args: string[],
  options: CliOptions,
): Promise<void> {
  const { positional, flags } = parseArgs(
    args,
    {
      "dry-run": { hasValue: false },
      help: { short: "h", hasValue: false },
    },
    "export",
  );

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex export${colors.reset} - Export tasks to GitHub Issues (one-way, no sync)

${colors.bold}USAGE:${colors.reset}
  dex export <task-id>...     # Export one or more tasks
  dex export --dry-run        # Preview without creating issues

${colors.bold}ARGUMENTS:${colors.reset}
  <task-id>...                One or more task IDs to export (required)

${colors.bold}OPTIONS:${colors.reset}
  --dry-run                   Show what would be exported without making changes
  -h, --help                  Show this help message

${colors.bold}DIFFERENCE FROM SYNC:${colors.reset}
  Unlike 'dex sync', export creates GitHub issues without saving
  the issue metadata back to the task. This is useful for sharing
  tasks externally without enabling bidirectional sync.

${colors.bold}REQUIREMENTS:${colors.reset}
  - Git repository with GitHub remote
  - GITHUB_TOKEN environment variable

${colors.bold}EXAMPLE:${colors.reset}
  dex export abc123                 # Export single task
  dex export abc123 def456          # Export multiple tasks
  dex export abc123 --dry-run       # Preview export
`);
    return;
  }

  const taskIds = positional;
  const dryRun = getBooleanFlag(flags, "dry-run");

  if (taskIds.length === 0) {
    console.error(
      `${colors.red}Error:${colors.reset} At least one task ID is required`,
    );
    console.error(`Usage: dex export <task-id>...`);
    process.exit(1);
  }

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
  const store = await options.storage.readAsync();

  let exportedCount = 0;
  let skippedCount = 0;

  for (const taskId of taskIds) {
    try {
      const task = await service.get(taskId);
      if (!task) {
        console.error(
          `${colors.red}Error:${colors.reset} Task ${taskId} not found`,
        );
        continue;
      }

      // Find root task if this is a subtask
      const rootTask = await findRootTask(service, task);

      // Check if already synced
      if (getGitHubIssueNumber(rootTask)) {
        console.log(
          `${colors.yellow}Skipped${colors.reset} ${colors.bold}${rootTask.id}${colors.reset}: already synced to GitHub`,
        );
        skippedCount++;
        continue;
      }

      if (dryRun) {
        console.log(
          `Would export to ${colors.cyan}${repo.owner}/${repo.repo}${colors.reset}:`,
        );
        console.log(
          `  [create] ${colors.bold}${rootTask.id}${colors.reset}: ${rootTask.name}`,
        );
        exportedCount++;
        continue;
      }

      // Export the task (create issue but don't save metadata)
      const result = await syncService.syncTask(rootTask, store);

      if (result) {
        console.log(
          `${colors.green}Exported${colors.reset} task ${colors.bold}${rootTask.id}${colors.reset} to ${colors.cyan}${repo.owner}/${repo.repo}${colors.reset}`,
        );
        console.log(`  ${colors.dim}${result.github.issueUrl}${colors.reset}`);
        exportedCount++;
      }
    } catch (err) {
      console.error(
        `${colors.red}Error${colors.reset} exporting ${taskId}: ${formatCliError(err)}`,
      );
    }
  }

  // Summary for multiple tasks
  if (taskIds.length > 1) {
    const parts = [];
    if (exportedCount > 0) {
      parts.push(
        `${exportedCount} ${dryRun ? "would be exported" : "exported"}`,
      );
    }
    if (skippedCount > 0) {
      parts.push(`${skippedCount} skipped`);
    }
    if (parts.length > 0) {
      console.log(`\n${parts.join(", ")}`);
    }
  }
}
