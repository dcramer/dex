import {
  CliOptions,
  colors,
  createService,
  formatCliError,
  getBooleanFlag,
  parseArgs,
  promptConfirm,
} from "./utils.js";

export async function deleteCommand(args: string[], options: CliOptions): Promise<void> {
  const { positional, flags } = parseArgs(args, {
    force: { short: "f", hasValue: false },
    help: { short: "h", hasValue: false },
  }, "delete");

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex delete${colors.reset} - Delete a task

${colors.bold}USAGE:${colors.reset}
  dex delete <task-id> [options]

${colors.bold}ARGUMENTS:${colors.reset}
  <task-id>                  Task ID to delete (required)

${colors.bold}OPTIONS:${colors.reset}
  -f, --force                Delete without confirmation (even if has subtasks)
  -h, --help                 Show this help message

${colors.bold}EXAMPLE:${colors.reset}
  dex delete abc123          # Prompts if task has subtasks
  dex delete abc123 -f       # Force delete without prompting
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

  const service = createService(options);
  const task = await service.get(id);

  if (!task) {
    console.error(`${colors.red}Error:${colors.reset} Task ${colors.bold}${id}${colors.reset} not found`);
    const allTasks = await service.list({ all: true });
    if (allTasks.length > 0) {
      console.error(`${colors.dim}Hint: Run "dex list --all" to see all tasks${colors.reset}`);
    }
    process.exit(1);
  }

  const children = await service.getChildren(id);

  // If task has children and not forced, prompt for confirmation
  if (children.length > 0 && !force) {
    const childCount = children.length;
    const message = `Task ${id} has ${childCount} subtask${childCount > 1 ? "s" : ""} that will also be deleted. Continue? (y/n) `;

    const confirmed = await promptConfirm(message);
    if (!confirmed) {
      console.log("Aborted.");
      process.exit(0);
    }
  }

  try {
    await service.delete(id);
    if (children.length > 0) {
      console.log(`${colors.green}Deleted${colors.reset} task ${colors.bold}${id}${colors.reset} and ${children.length} subtask${children.length > 1 ? "s" : ""}`);
    } else {
      console.log(`${colors.green}Deleted${colors.reset} task ${colors.bold}${id}${colors.reset}`);
    }
  } catch (err) {
    console.error(formatCliError(err));
    process.exit(1);
  }
}
