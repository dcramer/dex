import {
  CliOptions,
  colors,
  createService,
  formatCliError,
  getBooleanFlag,
  getStringFlag,
  parseArgs,
} from "./utils.js";
import { formatTaskShow } from "./show.js";

export async function completeCommand(args: string[], options: CliOptions): Promise<void> {
  const { positional, flags } = parseArgs(args, {
    result: { short: "r", hasValue: true },
    help: { short: "h", hasValue: false },
  }, "complete");

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex complete${colors.reset} - Mark a task as completed

${colors.bold}USAGE:${colors.reset}
  dex complete <task-id> --result "completion notes"

${colors.bold}ARGUMENTS:${colors.reset}
  <task-id>                  Task ID to complete (required)

${colors.bold}OPTIONS:${colors.reset}
  -r, --result <text>        Completion result/notes (required)
  -h, --help                 Show this help message

${colors.bold}EXAMPLE:${colors.reset}
  dex complete abc123 --result "Fixed by updating auth token refresh logic"
  dex complete abc123 -r "Implemented and tested"
`);
    return;
  }

  const id = positional[0];
  const result = getStringFlag(flags, "result");

  if (!id) {
    console.error(`${colors.red}Error:${colors.reset} Task ID is required`);
    console.error(`Usage: dex complete <task-id> --result "completion notes"`);
    process.exit(1);
  }

  if (!result) {
    console.error(`${colors.red}Error:${colors.reset} --result (-r) is required`);
    console.error(`Usage: dex complete <task-id> --result "completion notes"`);
    process.exit(1);
  }

  const service = createService(options);
  try {
    const task = await service.complete(id, result);

    console.log(`${colors.green}Completed${colors.reset} task ${colors.bold}${id}${colors.reset}`);
    console.log(formatTaskShow(task, { full: true }));
  } catch (err) {
    console.error(formatCliError(err));
    process.exit(1);
  }
}
