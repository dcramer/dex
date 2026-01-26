import { CliOptions, createService, formatCliError } from "./utils.js";
import { colors } from "./colors.js";
import {
  getBooleanFlag,
  getStringFlag,
  parseArgs,
  parseIntFlag,
} from "./args.js";
import { formatTask } from "./formatting.js";

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
  -h, --help                 Show this help message

${colors.bold}EXAMPLE:${colors.reset}
  dex edit abc123 -n "Updated name"
  dex edit abc123 -p 1
  dex edit abc123 --description "More details about the task"
  dex edit abc123 --add-blocker def456
  dex edit abc123 --remove-blocker def456
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

  const service = createService(options);
  try {
    const task = await service.update({
      id,
      name: getStringFlag(flags, "name"),
      description: getStringFlag(flags, "description"),
      parent_id: getStringFlag(flags, "parent"),
      priority: parseIntFlag(flags, "priority"),
      add_blocked_by: addBlockedBy,
      remove_blocked_by: removeBlockedBy,
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
