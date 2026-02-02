import type { CliOptions } from "./utils.js";
import {
  createService,
  exitIfTaskNotFound,
  formatCliError,
  promptConfirm,
} from "./utils.js";
import { colors } from "./colors.js";
import { getBooleanFlag, parseArgs, validateSinglePositional } from "./args.js";
import { pluralize } from "./formatting.js";

export async function deleteCommand(
  args: string[],
  options: CliOptions,
): Promise<void> {
  const { positional, flags } = parseArgs(
    args,
    {
      force: { short: "f", hasValue: false },
      help: { short: "h", hasValue: false },
    },
    "delete",
  );

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex delete${colors.reset} - Delete a task

${colors.bold}USAGE:${colors.reset}
  dex delete <task-id> [options]
  dex rm <task-id> [options]
  dex remove <task-id> [options]

${colors.bold}ARGUMENTS:${colors.reset}
  <task-id>                  Task ID to delete (required)

${colors.bold}OPTIONS:${colors.reset}
  -f, --force                Delete without confirmation (even if has subtasks)
  -h, --help                 Show this help message

${colors.bold}EXAMPLES:${colors.reset}
  dex delete abc123          # Prompts if task has subtasks
  dex rm abc123 -f           # Force delete without prompting (using alias)
  dex remove abc123          # Same as delete (using alias)
`);
    return;
  }

  const id = positional[0];
  const force = getBooleanFlag(flags, "force");

  if (!id) {
    console.error(`${colors.red}Error:${colors.reset} Task ID is required`);
    console.error(`Usage: dex delete <task-id>`);
    process.exit(1);
  }

  validateSinglePositional(positional, "delete");

  const service = createService(options);
  const task = await service.get(id);
  await exitIfTaskNotFound(task, id, service);

  const children = await service.getChildren(id);

  // If task has children and not forced, prompt for confirmation
  if (children.length > 0 && !force) {
    const message = `Task ${id} has ${children.length} ${pluralize(children.length, "subtask")} that will also be deleted. Continue? (y/n) `;

    const confirmed = await promptConfirm(message);
    if (!confirmed) {
      console.log("Aborted.");
      process.exit(0);
    }
  }

  try {
    await service.delete(id);
    if (children.length > 0) {
      console.log(
        `${colors.green}Deleted${colors.reset} task ${colors.bold}${id}${colors.reset} and ${children.length} ${pluralize(children.length, "subtask")}`,
      );
    } else {
      console.log(
        `${colors.green}Deleted${colors.reset} task ${colors.bold}${id}${colors.reset}`,
      );
    }
  } catch (err) {
    console.error(formatCliError(err));
    process.exit(1);
  }
}
