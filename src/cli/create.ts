import type { CliOptions } from "./utils.js";
import { createService, formatCliError } from "./utils.js";
import { colors } from "./colors.js";
import {
  getBooleanFlag,
  getStringFlag,
  parseArgs,
  parseIntFlag,
} from "./args.js";
import { formatTaskShow } from "./show.js";

export async function createCommand(
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
      "blocked-by": { short: "b", hasValue: true },
      help: { short: "h", hasValue: false },
    },
    "create",
  );

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex create${colors.reset} - Create a new task

${colors.bold}USAGE:${colors.reset}
  dex create "name" [--description "details"] [options]
  dex create -n "name" [--description "details"] [options]

${colors.bold}OPTIONS:${colors.reset}
  -n, --name <text>          Task name (or use positional arg)
  -d, --description <text>   Task description/details (optional)
  -p, --priority <n>         Priority level (lower = higher priority, default: 1)
  --parent <id>              Parent task ID (creates subtask)
  -b, --blocked-by <ids>     Comma-separated task IDs that block this task
  -h, --help                 Show this help message

${colors.bold}EXAMPLES:${colors.reset}
  dex create "Fix login bug"
  dex create "Fix login bug" --description "Users report 500 errors on /login"
  dex create "Write tests" --description "Cover auth module" -p 2
  dex create "Subtask" --description "Part of bigger task" --parent abc123
  dex create "Deploy" --description "Release to prod" --blocked-by abc123,def456
`);
    return;
  }

  // Accept name from positional arg or -n flag
  const name = positional[0] || getStringFlag(flags, "name");
  const description = getStringFlag(flags, "description");

  // Error if extra positional arguments are provided
  if (positional.length > 1) {
    console.error(
      `${colors.red}Error:${colors.reset} unexpected positional argument: "${positional[1]}"`,
    );
    console.error(`Usage: dex create "task name" [--description "details"]`);
    console.error(`Hint: Use --description or -d to provide a description`);
    process.exit(1);
  }

  if (!name) {
    console.error(`${colors.red}Error:${colors.reset} name is required`);
    console.error(`Usage: dex create "task name" [--description "details"]`);
    process.exit(1);
  }

  // Parse blocked-by as comma-separated list
  const blockedByStr = getStringFlag(flags, "blocked-by");
  const blockedBy = blockedByStr
    ? blockedByStr
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  const service = createService(options);
  try {
    const task = await service.create({
      name,
      description,
      parent_id: getStringFlag(flags, "parent"),
      priority: parseIntFlag(flags, "priority"),
      blocked_by: blockedBy,
    });

    // Fetch related info for richer output
    const ancestors = await service.getAncestors(task.id);
    const blockedByTasks = await service.getIncompleteBlockers(task.id);

    console.log(
      `${colors.green}Created${colors.reset} task ${colors.bold}${task.id}${colors.reset}`,
    );
    console.log(formatTaskShow(task, { ancestors, blockedByTasks }));
  } catch (err) {
    console.error(formatCliError(err));
    process.exit(1);
  }
}
