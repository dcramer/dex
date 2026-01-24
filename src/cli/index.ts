import { CliOptions, colors, getSuggestion } from "./utils.js";
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

export type { CliOptions } from "./utils.js";

export async function runCli(args: string[], options: CliOptions): Promise<void> {
  const command = args[0];

  switch (command) {
    case "init":
      return await initCommand(args.slice(1));
    case "create":
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
    case "delete":
    case "rm":
    case "remove":
      return await deleteCommand(args.slice(1), options);
    case "plan":
      return await planCommand(args.slice(1), options);
    case "completion":
      return completionCommand(args.slice(1));
    case "help":
    case "--help":
    case "-h":
      return helpCommand();
    default:
      if (!command) {
        return await listCommand([], options);
      }
      console.error(`${colors.red}Error:${colors.reset} Unknown command: ${command}`);
      const suggestion = getSuggestion(command);
      if (suggestion) {
        console.error(`Did you mean "${colors.cyan}${suggestion}${colors.reset}"?`);
      }
      console.error(`Run "${colors.dim}dex help${colors.reset}" for usage information.`);
      process.exit(1);
  }
}
