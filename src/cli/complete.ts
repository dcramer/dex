import type { CliOptions } from "./utils.js";
import { createService, formatCliError } from "./utils.js";
import { colors } from "./colors.js";
import { getBooleanFlag, getStringFlag, parseArgs } from "./args.js";
import { formatTaskShow } from "./show.js";
import { getCommitInfo } from "./git.js";

export async function completeCommand(
  args: string[],
  options: CliOptions,
): Promise<void> {
  const { positional, flags } = parseArgs(
    args,
    {
      result: { short: "r", hasValue: true },
      commit: { short: "c", hasValue: true },
      help: { short: "h", hasValue: false },
    },
    "complete",
  );

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex complete${colors.reset} - Mark a task as completed

${colors.bold}USAGE:${colors.reset}
  dex complete <task-id> --result "completion notes"

${colors.bold}ARGUMENTS:${colors.reset}
  <task-id>                  Task ID to complete (required)

${colors.bold}OPTIONS:${colors.reset}
  -r, --result <text>        Completion result/notes (required)
  -c, --commit <sha>         Git commit SHA that implements this task
  -h, --help                 Show this help message

${colors.bold}EXAMPLE:${colors.reset}
  dex complete abc123 --result "Fixed by updating auth token refresh logic"
  dex complete abc123 -r "Implemented and tested" -c a1b2c3d
`);
    return;
  }

  const id = positional[0];
  const result = getStringFlag(flags, "result");
  const commitSha = getStringFlag(flags, "commit");

  if (!id) {
    console.error(`${colors.red}Error:${colors.reset} Task ID is required`);
    console.error(`Usage: dex complete <task-id> --result "completion notes"`);
    process.exit(1);
  }

  if (!result) {
    console.error(
      `${colors.red}Error:${colors.reset} --result (-r) is required`,
    );
    console.error(`Usage: dex complete <task-id> --result "completion notes"`);
    process.exit(1);
  }

  const service = createService(options);
  try {
    // Check for incomplete blockers and warn
    const incompleteBlockers = await service.getIncompleteBlockers(id);
    if (incompleteBlockers.length > 0) {
      console.log(
        `${colors.yellow}Warning:${colors.reset} This task is blocked by ${incompleteBlockers.length} incomplete task(s):`,
      );
      for (const blocker of incompleteBlockers) {
        console.log(
          `  ${colors.dim}•${colors.reset} ${colors.bold}${blocker.id}${colors.reset}: ${blocker.name}`,
        );
      }
      console.log("");
    }

    const metadata = commitSha
      ? {
          commit: {
            ...getCommitInfo(commitSha),
            timestamp: new Date().toISOString(),
          },
        }
      : undefined;

    const task = await service.complete(id, result, metadata);

    console.log(
      `${colors.green}Completed${colors.reset} task ${colors.bold}${id}${colors.reset}`,
    );
    console.log(formatTaskShow(task));

    // Check if all sibling subtasks are now complete and hint about parent
    if (task.parent_id) {
      const siblings = await service.getChildren(task.parent_id);
      const allSiblingsComplete = siblings.every((s) => s.completed);

      if (allSiblingsComplete) {
        const parent = await service.get(task.parent_id);
        console.log("");
        console.log(
          `${colors.cyan}Hint:${colors.reset} All subtasks of ${colors.bold}${parent?.name || task.parent_id}${colors.reset} are now complete.`,
        );
        console.log(
          `  ${colors.dim}•${colors.reset} Complete parent: ${colors.cyan}dex complete ${task.parent_id} --result "..."${colors.reset}`,
        );
      }
    }
  } catch (err) {
    console.error(formatCliError(err));
    process.exit(1);
  }
}
