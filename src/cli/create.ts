import {
  CliOptions,
  colors,
  createService,
  formatCliError,
  formatTask,
  getBooleanFlag,
  getStringFlag,
  parseArgs,
  parseIntFlag,
} from "./utils.js";

export async function createCommand(args: string[], options: CliOptions): Promise<void> {
  const { flags } = parseArgs(args, {
    description: { short: "d", hasValue: true },
    context: { hasValue: true },
    priority: { short: "p", hasValue: true },
    parent: { hasValue: true },
    "blocked-by": { short: "b", hasValue: true },
    help: { short: "h", hasValue: false },
  }, "create");

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex create${colors.reset} - Create a new task

${colors.bold}USAGE:${colors.reset}
  dex create -d "description" --context "context" [options]

${colors.bold}OPTIONS:${colors.reset}
  -d, --description <text>   Task description (required)
  --context <text>           Task context/details (required)
  -p, --priority <n>         Priority level (lower = higher priority, default: 1)
  --parent <id>              Parent task ID (creates subtask)
  -b, --blocked-by <ids>     Comma-separated task IDs that block this task
  -h, --help                 Show this help message

${colors.bold}EXAMPLE:${colors.reset}
  dex create -d "Fix login bug" --context "Users report 500 errors on /login"
  dex create -d "Write tests" --context "Cover auth module" -p 2
  dex create -d "Subtask" --context "Part of bigger task" --parent abc123
  dex create -d "Deploy" --context "Release to prod" --blocked-by abc123,def456
`);
    return;
  }

  const description = getStringFlag(flags, "description");
  const context = getStringFlag(flags, "context");

  if (!description) {
    console.error(`${colors.red}Error:${colors.reset} --description (-d) is required`);
    console.error(`Usage: dex create -d "task description" --context "context info"`);
    process.exit(1);
  }

  if (!context) {
    console.error(`${colors.red}Error:${colors.reset} --context is required`);
    console.error(`Usage: dex create -d "task description" --context "context info"`);
    process.exit(1);
  }

  // Parse blocked-by as comma-separated list
  const blockedByStr = getStringFlag(flags, "blocked-by");
  const blockedBy = blockedByStr
    ? blockedByStr.split(",").map((s) => s.trim()).filter(Boolean)
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

    console.log(`${colors.green}Created${colors.reset} task ${colors.bold}${task.id}${colors.reset}`);
    console.log(formatTask(task, {}));
  } catch (err) {
    console.error(formatCliError(err));
    process.exit(1);
  }
}
