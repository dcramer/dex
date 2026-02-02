import { colors } from "./colors.js";

export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

export interface FlagConfig {
  short?: string;
  hasValue: boolean;
}

// Available commands for suggestions
export const COMMANDS = [
  "create",
  "list",
  "ls",
  "show",
  "edit",
  "update",
  "complete",
  "done",
  "delete",
  "rm",
  "remove",
  "archive",
  "plan",
  "sync",
  "import",
  "doctor",
  "status",
  "config",
  "help",
  "mcp",
  "completion",
];

// Calculate Levenshtein distance for command suggestions
export function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1,
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

export function getSuggestion(input: string): string | null {
  let bestMatch: string | null = null;
  let bestDistance = Infinity;

  for (const cmd of COMMANDS) {
    const distance = levenshtein(input.toLowerCase(), cmd);
    if (distance < bestDistance && distance <= 2) {
      bestDistance = distance;
      bestMatch = cmd;
    }
  }

  return bestMatch;
}

export function getStringFlag(
  flags: ParsedArgs["flags"],
  name: string,
): string | undefined {
  const value = flags[name];
  // Treat empty strings as missing values (can happen when flag is at end of args)
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return undefined;
}

export function getBooleanFlag(
  flags: ParsedArgs["flags"],
  name: string,
): boolean {
  return flags[name] === true;
}

export function parseIntFlag(
  flags: ParsedArgs["flags"],
  name: string,
): number | undefined {
  const value = getStringFlag(flags, name);
  if (value === undefined) return undefined;

  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    console.error(
      `${colors.red}Error:${colors.reset} Invalid value for --${name}: expected a number, got "${value}"`,
    );
    process.exit(1);
  }
  return parsed;
}

interface PositionalValidationOptions {
  hint?: string;
}

/**
 * Validate that a command received at most one positional argument.
 * Exits with an error if extra positional arguments are found.
 */
export function validateSinglePositional(
  positional: string[],
  commandName: string,
  options: PositionalValidationOptions = {},
): void {
  if (positional.length <= 1) return;

  console.error(
    `${colors.red}Error:${colors.reset} unexpected positional argument: "${positional[1]}"`,
  );
  console.error(`Usage: dex ${commandName} <task-id> [options]`);
  if (options.hint) {
    console.error(`Hint: ${options.hint}`);
  }
  process.exit(1);
}

/**
 * Suggest a similar flag name using Levenshtein distance.
 */
function getFlagSuggestion(
  input: string,
  flagDefs: Record<string, FlagConfig>,
): string | null {
  const flagNames = Object.keys(flagDefs);
  let bestMatch: string | null = null;
  let bestDistance = Infinity;

  for (const flag of flagNames) {
    const distance = levenshtein(input.toLowerCase(), flag.toLowerCase());
    if (distance < bestDistance && distance <= 2) {
      bestDistance = distance;
      bestMatch = flag;
    }
  }

  return bestMatch;
}

export function parseArgs(
  args: string[],
  flagDefs: Record<string, FlagConfig>,
  commandName?: string,
): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const unknownFlags: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith("--")) {
      const flagName = arg.slice(2);
      const flagConfig = flagDefs[flagName];

      if (!flagConfig) {
        unknownFlags.push(arg);
        continue;
      }

      if (flagConfig.hasValue) {
        flags[flagName] = args[++i] || "";
      } else {
        flags[flagName] = true;
      }
      continue;
    }

    if (arg.startsWith("-") && arg.length === 2) {
      const shortFlag = arg.slice(1);
      const flagEntry = Object.entries(flagDefs).find(
        ([, config]) => config.short === shortFlag,
      );

      if (!flagEntry) {
        unknownFlags.push(arg);
        continue;
      }

      const [flagName, flagConfig] = flagEntry;
      if (flagConfig.hasValue) {
        flags[flagName] = args[++i] || "";
      } else {
        flags[flagName] = true;
      }
      continue;
    }

    if (arg.startsWith("-") && arg.length > 2) {
      unknownFlags.push(arg);
      continue;
    }

    positional.push(arg);
  }

  // Report unknown flags
  if (unknownFlags.length > 0) {
    const flag = unknownFlags[0];
    const flagName = flag.replace(/^-+/, "");
    const suggestion = getFlagSuggestion(flagName, flagDefs);

    let errorMsg = `${colors.red}Error:${colors.reset} Unknown option: ${flag}`;
    if (suggestion) {
      errorMsg += `\nDid you mean "--${suggestion}"?`;
    }

    const cmd = commandName ? `dex ${commandName}` : "dex <command>";
    errorMsg += `\nRun ${colors.cyan}${cmd} --help${colors.reset} for usage.`;

    console.error(errorMsg);
    process.exit(1);
  }

  return { positional, flags };
}
