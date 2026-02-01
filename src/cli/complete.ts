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
      "no-commit": { hasValue: false },
      help: { short: "h", hasValue: false },
    },
    "complete",
  );

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex complete${colors.reset} - Mark a task as completed

${colors.bold}USAGE:${colors.reset}
  dex complete <task-id> --result "completion notes" [--commit <sha>|--no-commit]

${colors.bold}ARGUMENTS:${colors.reset}
  <task-id>                  Task ID to complete (required)

${colors.bold}OPTIONS:${colors.reset}
  -r, --result <text>        Completion result/notes (required)
  -c, --commit <sha>         Git commit SHA that implements this task
  --no-commit                Complete without linking a commit (issue stays open)
  -h, --help                 Show this help message

${colors.bold}NOTES:${colors.reset}
  For tasks linked to GitHub issues or Shortcut stories, you must specify either
  --commit or --no-commit. This ensures issues are only closed when code is merged.

${colors.bold}EXAMPLE:${colors.reset}
  dex complete abc123 --result "Fixed by updating auth token refresh logic" --commit a1b2c3d
  dex complete abc123 -r "Implemented and tested" -c a1b2c3d
  dex complete abc123 --result "Planning complete, no code changes" --no-commit
`);
    return;
  }

  const id = positional[0];
  const result = getStringFlag(flags, "result");
  const commitSha = getStringFlag(flags, "commit");
  const hasNoCommit = getBooleanFlag(flags, "no-commit");

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

  if (commitSha && hasNoCommit) {
    console.error(
      `${colors.red}Error:${colors.reset} Cannot use both --commit and --no-commit`,
    );
    process.exit(1);
  }

  const service = createService(options);
  try {
    // Fetch task to check for remote links
    const existingTask = await service.get(id);
    if (!existingTask) {
      console.error(`${colors.red}Error:${colors.reset} Task ${id} not found`);
      process.exit(1);
    }

    // Check if this is a leaf task (no subtasks) with a remote link
    const hasRemoteLink = !!(
      existingTask.metadata?.github || existingTask.metadata?.shortcut
    );
    const subtasks = await service.getChildren(id);
    const isLeafTask = subtasks.length === 0;

    // Only require --commit/--no-commit for leaf tasks with remote links
    if (hasRemoteLink && isLeafTask && !commitSha && !hasNoCommit) {
      const issueRef = existingTask.metadata?.github
        ? `GitHub issue #${existingTask.metadata.github.issueNumber}`
        : `Shortcut story`;
      console.error(
        `${colors.red}Error:${colors.reset} Task is linked to ${issueRef}.`,
      );
      console.error(
        `  Use ${colors.cyan}--commit <sha>${colors.reset} to link a commit (closes issue when merged)`,
      );
      console.error(
        `  Use ${colors.cyan}--no-commit${colors.reset} to complete without a commit (issue stays open)`,
      );
      process.exit(1);
    }

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
        const parentHasRemoteLink = !!(
          parent?.metadata?.github || parent?.metadata?.shortcut
        );
        console.log("");
        console.log(
          `${colors.cyan}Hint:${colors.reset} All subtasks of ${colors.bold}${parent?.name || task.parent_id}${colors.reset} are now complete.`,
        );
        if (parentHasRemoteLink) {
          console.log(
            `  ${colors.dim}•${colors.reset} Complete parent: ${colors.cyan}dex complete ${task.parent_id} --result "..."${colors.reset}`,
          );
          console.log(
            `  ${colors.dim}  ${colors.reset}(Parent task with subtasks doesn't require --commit/--no-commit)`,
          );
        } else {
          console.log(
            `  ${colors.dim}•${colors.reset} Complete parent: ${colors.cyan}dex complete ${task.parent_id} --result "..."${colors.reset}`,
          );
        }
      }
    }
  } catch (err) {
    console.error(formatCliError(err));
    process.exit(1);
  }
}
