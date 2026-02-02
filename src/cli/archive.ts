import type { CliOptions } from "./utils.js";
import { createService, exitIfTaskNotFound, formatCliError } from "./utils.js";
import { colors } from "./colors.js";
import {
  getBooleanFlag,
  getStringFlag,
  parseArgs,
  validateSinglePositional,
} from "./args.js";
import { pluralize } from "./formatting.js";
import type { ArchiveResult } from "../core/task-service.js";

export async function archiveCommand(
  args: string[],
  options: CliOptions,
): Promise<void> {
  const { positional, flags } = parseArgs(
    args,
    {
      help: { short: "h", hasValue: false },
      "older-than": { hasValue: true },
      completed: { hasValue: false },
      except: { hasValue: true },
      "dry-run": { hasValue: false },
    },
    "archive",
  );

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex archive${colors.reset} - Archive completed tasks

${colors.bold}USAGE:${colors.reset}
  dex archive <task-id>
  dex archive --completed [--except <ids>]
  dex archive --older-than <duration> [--except <ids>]

${colors.bold}ARGUMENTS:${colors.reset}
  <task-id>                  Task ID to archive

${colors.bold}OPTIONS:${colors.reset}
  --older-than <duration>    Archive tasks completed more than <duration> ago
                             Format: 30d (days), 12w (weeks), 6m (months)
  --completed                Archive ALL completed tasks (use with caution)
  --except <ids>             Comma-separated task IDs to exclude from bulk archive
  --dry-run                  Show what would be archived without making changes
  -h, --help                 Show this help message

${colors.bold}REQUIREMENTS:${colors.reset}
  - Task and all descendants must be completed
  - Task must not have any incomplete ancestors

${colors.bold}DESCRIPTION:${colors.reset}
  Archives completed tasks and their descendants to reduce storage size.
  Archived tasks are compacted and moved to archive.jsonl.

  Use ${colors.cyan}dex list --archived${colors.reset} to view archived tasks.

${colors.bold}EXAMPLES:${colors.reset}
  dex archive abc123                    # Archive a specific task
  dex archive --older-than 60d          # Archive tasks completed >60 days ago
  dex archive --completed               # Archive ALL completed tasks
  dex archive --completed --except abc  # Archive all except task abc
  dex archive --older-than 30d --dry-run  # Preview what would be archived
`);
    return;
  }

  const id = positional[0];
  const olderThan = getStringFlag(flags, "older-than");
  const archiveAllCompleted = getBooleanFlag(flags, "completed");
  const exceptIds = getStringFlag(flags, "except")
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const dryRun = getBooleanFlag(flags, "dry-run");

  // Handle bulk operations
  if (olderThan || archiveAllCompleted) {
    if (positional.length > 0) {
      console.error(
        `${colors.red}Error:${colors.reset} Cannot combine task ID with --older-than or --completed`,
      );
      console.error(`Use either: dex archive <task-id>`);
      console.error(`       or:  dex archive --completed`);
      console.error(`       or:  dex archive --older-than <duration>`);
      process.exit(1);
    }
    return await bulkArchive(options, {
      olderThan,
      archiveAllCompleted,
      exceptIds,
      dryRun,
    });
  }

  // Single task archive - validate no extra positional args
  validateSinglePositional(positional, "archive");

  if (!id) {
    console.error(`${colors.red}Error:${colors.reset} Task ID is required`);
    console.error(`Usage: dex archive <task-id>`);
    console.error(`       dex archive --older-than <duration>`);
    console.error(`       dex archive --completed`);
    process.exit(1);
  }

  const service = createService(options);
  const task = await service.get(id);
  await exitIfTaskNotFound(task, id, service);

  try {
    const result = await service.archive(id);
    displayArchiveResult(result, false);
  } catch (err) {
    console.error(formatCliError(err));
    process.exit(1);
  }
}

interface BulkArchiveCliOptions {
  olderThan?: string;
  archiveAllCompleted?: boolean;
  exceptIds?: string[];
  dryRun?: boolean;
}

/**
 * Bulk archive completed tasks based on criteria.
 */
async function bulkArchive(
  options: CliOptions,
  bulkOptions: BulkArchiveCliOptions,
): Promise<void> {
  const { olderThan, archiveAllCompleted, exceptIds, dryRun } = bulkOptions;

  const service = createService(options);

  try {
    const result = await service.bulkArchive({
      olderThan,
      archiveAllCompleted,
      exceptIds,
      dryRun,
    });

    if (!result) {
      console.log("No tasks found to archive.");
      return;
    }

    if (dryRun) {
      console.log(
        `${colors.cyan}Dry run:${colors.reset} Would archive ${colors.bold}${result.totalCount}${colors.reset} ${pluralize(result.totalCount, "task")} (${result.rootCount} root ${pluralize(result.rootCount, "task")})`,
      );
      return;
    }

    displayArchiveResult(result, true);
  } catch (err) {
    console.error(formatCliError(err));
    process.exit(1);
  }
}

/**
 * Display the result of an archive operation.
 * @param result Archive result to display
 * @param isBulk Whether this is a bulk operation (affects display format)
 */
function displayArchiveResult(result: ArchiveResult, isBulk: boolean): void {
  const { totalCount, rootCount, originalSize, archivedSize } = result;
  const reduction = Math.round((1 - archivedSize / originalSize) * 100);

  if (isBulk) {
    console.log(
      `${colors.green}Archived${colors.reset} ${colors.bold}${totalCount}${colors.reset} ${pluralize(totalCount, "task")} (${rootCount} root ${pluralize(rootCount, "task")})`,
    );
  } else {
    console.log(
      `${colors.green}Archived${colors.reset} ${colors.bold}${totalCount}${colors.reset} ${pluralize(totalCount, "task")}`,
    );
    if (totalCount > rootCount) {
      console.log(
        `  ${colors.dim}Subtasks:${colors.reset} ${totalCount - rootCount}`,
      );
    }
  }
  console.log(`  ${colors.dim}Size reduction:${colors.reset} ${reduction}%`);
}
