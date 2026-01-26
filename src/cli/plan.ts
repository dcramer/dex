import { CliOptions, createService, formatCliError } from "./utils.js";
import { colors } from "./colors.js";
import {
  getBooleanFlag,
  getStringFlag,
  parseArgs,
  parseIntFlag,
} from "./args.js";
import { formatTask } from "./formatting.js";
import { parsePlanFile } from "../core/plan-parser.js";

export async function planCommand(
  args: string[],
  options: CliOptions,
): Promise<void> {
  const { positional, flags } = parseArgs(
    args,
    {
      priority: { short: "p", hasValue: true },
      parent: { hasValue: true },
      help: { short: "h", hasValue: false },
    },
    "plan",
  );

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex plan${colors.reset} - Create task from plan markdown file

${colors.bold}USAGE:${colors.reset}
  dex plan <file> [options]

${colors.bold}OPTIONS:${colors.reset}
  -p, --priority <n>    Priority level (lower = higher priority, default: 1)
  --parent <id>         Parent task ID (creates subtask)
  -h, --help            Show this help message

${colors.bold}EXAMPLE:${colors.reset}
  dex plan ~/.claude/plans/my-plan.md
  dex plan /tmp/feature-plan.md --priority 2
  dex plan plan.md --parent abc123
`);
    return;
  }

  const filePath = positional[0];
  if (!filePath) {
    console.error(`${colors.red}Error:${colors.reset} Plan file path required`);
    console.error(`Usage: dex plan <file> [options]`);
    process.exit(1);
  }

  const service = createService(options);
  try {
    const { title, content } = await parsePlanFile(filePath);
    const task = await service.create({
      name: title,
      description: content,
      parent_id: getStringFlag(flags, "parent"),
      priority: parseIntFlag(flags, "priority"),
    });

    console.log(
      `${colors.green}Created${colors.reset} task ${colors.bold}${task.id}${colors.reset} from plan`,
    );
    console.log(formatTask(task, {}));
  } catch (err) {
    console.error(formatCliError(err));
    process.exit(1);
  }
}
