import * as fs from "node:fs";
import * as path from "node:path";
import type { CliOptions } from "./utils.js";
import { colors } from "./colors.js";
import { getSuggestion } from "./args.js";
import { createCommand } from "./create.js";
import { listCommand } from "./list.js";
import { showCommand } from "./show.js";
import { editCommand } from "./edit.js";
import { completeCommand } from "./complete.js";
import { deleteCommand } from "./delete.js";
import { initCommand } from "./init.js";
import { helpCommand } from "./help.js";
import { planCommand } from "./plan.js";
import { completionCommand } from "./completion.js";
import { syncCommand } from "./sync.js";
import { importCommand } from "./import.js";
import { exportCommand } from "./export.js";
import { doctorCommand } from "./doctor.js";
import { statusCommand } from "./status.js";
import { configCommand } from "./config.js";
import { dirCommand } from "./dir.js";
import { archiveCommand } from "./archive.js";
import { startCommand } from "./start.js";

export type { CliOptions } from "./utils.js";

/**
 * Check for misplaced tasks from v0.4.0 tilde expansion bug.
 * Warn user to run `dex doctor --fix` if found.
 */
function checkForMisplacedTasks(): void {
  const literalTildePath = path.join(process.cwd(), "~", ".dex", "tasks");

  try {
    if (fs.existsSync(literalTildePath)) {
      const taskFiles = fs
        .readdirSync(literalTildePath)
        .filter((f) => f.endsWith(".json"));

      if (taskFiles.length > 0) {
        console.error(
          `${colors.yellow}Warning:${colors.reset} Found ${taskFiles.length} task(s) in wrong location (tilde expansion bug).\n` +
            `Run ${colors.bold}dex doctor --fix${colors.reset} to migrate them to the correct location.\n`,
        );
      }
    }
  } catch (err) {
    // Ignore errors checking for misplaced tasks
  }
}

export async function runCli(
  args: string[],
  options: CliOptions,
): Promise<void> {
  const command = args[0];

  // Check for misplaced tasks on every command except doctor (to avoid double-warning)
  if (command !== "doctor") {
    checkForMisplacedTasks();
  }

  switch (command) {
    case "init":
      return await initCommand(args.slice(1));
    case "config":
      return await configCommand(args.slice(1), {
        storagePath: options.storage.getIdentifier(),
      });
    case "dir":
      return dirCommand(args.slice(1));
    case "create":
    case "add":
      return await createCommand(args.slice(1), options);
    case "list":
    case "ls":
      return await listCommand(args.slice(1), options);
    case "show":
      return await showCommand(args.slice(1), options);
    case "edit":
    case "update":
      return await editCommand(args.slice(1), options);
    case "complete":
    case "done":
      return await completeCommand(args.slice(1), options);
    case "start":
      return await startCommand(args.slice(1), options);
    case "delete":
    case "rm":
    case "remove":
      return await deleteCommand(args.slice(1), options);
    case "plan":
      return await planCommand(args.slice(1), options);
    case "sync":
      return await syncCommand(args.slice(1), options);
    case "import":
      return await importCommand(args.slice(1), options);
    case "export":
      return await exportCommand(args.slice(1), options);
    case "doctor":
      return await doctorCommand(args.slice(1), options);
    case "archive":
      return await archiveCommand(args.slice(1), options);
    case "status":
      return await statusCommand(args.slice(1), options);
    case "completion":
      return completionCommand(args.slice(1));
    case "help":
    case "--help":
    case "-h":
      return helpCommand();
    default:
      if (!command) {
        return await statusCommand([], options);
      }
      console.error(
        `${colors.red}Error:${colors.reset} Unknown command: ${command}`,
      );
      const suggestion = getSuggestion(command);
      if (suggestion) {
        console.error(
          `Did you mean "${colors.cyan}${suggestion}${colors.reset}"?`,
        );
      }
      console.error(
        `Run ${colors.cyan}dex help${colors.reset} for usage information.`,
      );
      process.exit(1);
  }
}
