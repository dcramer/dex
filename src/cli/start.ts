import { CliOptions, createService, formatCliError } from "./utils.js";
import { colors } from "./colors.js";
import { getBooleanFlag, parseArgs } from "./args.js";
import { formatTaskShow } from "./show.js";

export async function startCommand(
  args: string[],
  options: CliOptions,
): Promise<void> {
  const { positional, flags } = parseArgs(
    args,
    {
      force: { short: "f", hasValue: false },
      help: { short: "h", hasValue: false },
    },
    "start",
  );

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex start${colors.reset} - Mark a task as in progress

${colors.bold}USAGE:${colors.reset}
  dex start <task-id> [options]

${colors.bold}ARGUMENTS:${colors.reset}
  <task-id>                  Task ID to start (required)

${colors.bold}OPTIONS:${colors.reset}
  -f, --force                Re-claim a task that's already in progress
  -h, --help                 Show this help message

${colors.bold}EXAMPLES:${colors.reset}
  dex start abc123           # Mark task as in progress
  dex start abc123 --force   # Re-claim a task already in progress
`);
    return;
  }

  const id = positional[0];
  const force = getBooleanFlag(flags, "force");

  if (!id) {
    console.error(`${colors.red}Error:${colors.reset} Task ID is required`);
    console.error(`Usage: dex start <task-id>`);
    process.exit(1);
  }

  const service = createService(options);
  try {
    const task = await service.start(id, { force });

    console.log(
      `${colors.green}Started${colors.reset} task ${colors.bold}${id}${colors.reset}`,
    );
    console.log(formatTaskShow(task));
  } catch (err) {
    console.error(formatCliError(err));
    process.exit(1);
  }
}
