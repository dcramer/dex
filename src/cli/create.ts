import { CliOptions, createService, formatCliError } from "./utils.js";
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
      description: { short: "d", hasValue: true },
      context: { hasValue: true },
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
  dex create "description" [--context "context"] [options]
  dex create -d "description" [--context "context"] [options]  ${colors.dim}# legacy${colors.reset}

${colors.bold}OPTIONS:${colors.reset}
  -d, --description <text>   Task description (deprecated: use positional arg)
  --context <text>           Task context/details (optional)
  -p, --priority <n>         Priority level (lower = higher priority, default: 1)
  --parent <id>              Parent task ID (creates subtask)
  -b, --blocked-by <ids>     Comma-separated task IDs that block this task
  -h, --help                 Show this help message

${colors.bold}EXAMPLES:${colors.reset}
  dex create "Fix login bug"
  dex create "Fix login bug" --context "Users report 500 errors on /login"
  dex create "Write tests" --context "Cover auth module" -p 2
  dex create "Subtask" --context "Part of bigger task" --parent abc123
  dex create "Deploy" --context "Release to prod" --blocked-by abc123,def456
`);
    return;
  }

  // Accept description from either positional arg or -d flag (for backward compatibility)
  const description = positional[0] || getStringFlag(flags, "description");
  const context = getStringFlag(flags, "context");

  if (!description) {
    console.error(`${colors.red}Error:${colors.reset} description is required`);
    console.error(
      `Usage: dex create "task description" [--context "context info"]`,
    );
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
      description,
      context,
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
