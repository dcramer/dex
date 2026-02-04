import type { CliOptions } from "./utils.js";
import { createService, formatCliError } from "./utils.js";
import { colors } from "./colors.js";
import {
  getBooleanFlag,
  getStringFlag,
  parseArgs,
  parseIntFlag,
} from "./args.js";
import { formatTask } from "./formatting.js";
import { getCommitInfo, verifyCommitExists } from "./git.js";

export async function editCommand(
  args: string[],
  options: CliOptions,
): Promise<void> {
  const { positional, flags } = parseArgs(
    args,
    {
      name: { short: "n", hasValue: true },
      description: { short: "d", hasValue: true },
      priority: { short: "p", hasValue: true },
      parent: { hasValue: true },
      "add-blocker": { hasValue: true },
      "remove-blocker": { hasValue: true },
      commit: { short: "c", hasValue: true },
      help: { short: "h", hasValue: false },
    },
    "edit",
  );

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex edit${colors.reset} - Edit an existing task

${colors.bold}USAGE:${colors.reset}
  dex edit <task-id> [options]

${colors.bold}ARGUMENTS:${colors.reset}
  <task-id>                  Task ID to edit (required)

${colors.bold}OPTIONS:${colors.reset}
  -n, --name <text>          New task name
  -d, --description <text>   New task description/details
  -p, --priority <n>         New priority level
  --parent <id>              New parent task ID
  --add-blocker <ids>        Comma-separated task IDs to add as blockers
  --remove-blocker <ids>     Comma-separated task IDs to remove as blockers
  -c, --commit <sha>         Link a git commit to the task
  -h, --help                 Show this help message

${colors.bold}EXAMPLE:${colors.reset}
  dex edit abc123 -n "Updated name"
  dex edit abc123 -p 1
  dex edit abc123 --description "More details about the task"
  dex edit abc123 --add-blocker def456
  dex edit abc123 --remove-blocker def456
  dex edit abc123 --commit a1b2c3d
`);
    return;
  }

  const id = positional[0];

  if (!id) {
    console.error(`${colors.red}Error:${colors.reset} Task ID is required`);
    console.error(`Usage: dex edit <task-id> [-n "new name"]`);
    process.exit(1);
  }

  // Parse blocker flags as comma-separated lists
  const addBlockerStr = getStringFlag(flags, "add-blocker");
  const addBlockedBy = addBlockerStr
    ? addBlockerStr
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  const removeBlockerStr = getStringFlag(flags, "remove-blocker");
  const removeBlockedBy = removeBlockerStr
    ? removeBlockerStr
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  const commitSha = getStringFlag(flags, "commit");

  // Verify commit exists if provided
  if (commitSha && !verifyCommitExists(commitSha)) {
    console.error(
      `${colors.red}Error:${colors.reset} Commit ${colors.bold}${commitSha}${colors.reset} not found in local repository`,
    );
    console.error(
      `  Verify the SHA exists with: ${colors.cyan}git rev-parse --verify ${commitSha}${colors.reset}`,
    );
    process.exit(1);
  }

  const service = createService(options);
  try {
    // Fetch existing task to merge metadata
    const existingTask = await service.get(id);
    if (!existingTask) {
      console.error(`${colors.red}Error:${colors.reset} Task ${id} not found`);
      process.exit(1);
    }

    // Build metadata update if commit provided
    let metadata = undefined;
    if (commitSha) {
      metadata = {
        ...existingTask.metadata,
        commit: {
          ...getCommitInfo(commitSha),
          timestamp: new Date().toISOString(),
        },
      };
    }

    const task = await service.update({
      id,
      name: getStringFlag(flags, "name"),
      description: getStringFlag(flags, "description"),
      parent_id: getStringFlag(flags, "parent"),
      priority: parseIntFlag(flags, "priority"),
      add_blocked_by: addBlockedBy,
      remove_blocked_by: removeBlockedBy,
      metadata,
    });

    console.log(
      `${colors.green}Updated${colors.reset} task ${colors.bold}${id}${colors.reset}`,
    );
    console.log(formatTask(task, {}));
  } catch (err) {
    console.error(formatCliError(err));
    process.exit(1);
  }
}
