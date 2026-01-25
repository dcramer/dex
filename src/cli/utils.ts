import { TaskService } from "../core/task-service.js";
import { StorageEngine } from "../core/storage-engine.js";
import { GitHubSyncService } from "../core/github-sync.js";
import { GitHubSyncConfig } from "../core/config.js";
import { Task } from "../types.js";
import { extractErrorInfo } from "../errors.js";
import * as readline from "readline";

export interface CliOptions {
  storage: StorageEngine;
  syncService?: GitHubSyncService | null;
  syncConfig?: GitHubSyncConfig | null;
}

export interface ParsedArgs {
  positional: string[];
  flags: Record<string, string | boolean>;
}

export interface FlagConfig {
  short?: string;
  hasValue: boolean;
}

export interface FormatTaskOptions {
  verbose?: boolean;
  treePrefix?: string;
  truncateDescription?: number;
  blockedByIds?: string[];  // IDs of incomplete tasks blocking this one
}

// Color support: disable if NO_COLOR is set or stdout is not a TTY
export const useColors = !process.env.NO_COLOR && process.stdout.isTTY;

// Terminal width for text wrapping
export const terminalWidth = process.stdout.columns || 80;

// ANSI color codes (only used when colors are enabled)
export const colors = {
  reset: useColors ? "\x1b[0m" : "",
  bold: useColors ? "\x1b[1m" : "",
  dim: useColors ? "\x1b[2m" : "",
  red: useColors ? "\x1b[31m" : "",
  green: useColors ? "\x1b[32m" : "",
  yellow: useColors ? "\x1b[33m" : "",
  cyan: useColors ? "\x1b[36m" : "",
};

// ASCII art banner for CLI headers
export const ASCII_BANNER = ` ____  _____ __ __
|    \\|   __|  |  |
|  |  |   __|-   -|
|____/|_____|__|__|`;

// Available commands for suggestions
export const COMMANDS = ["create", "list", "ls", "show", "edit", "update", "complete", "done", "delete", "rm", "remove", "plan", "sync", "import", "doctor", "status", "help", "mcp", "completion"];

export function createService(options: CliOptions): TaskService {
  return new TaskService({
    storage: options.storage,
    syncService: options.syncService,
    syncConfig: options.syncConfig,
  });
}

/**
 * Get IDs of incomplete tasks that are blocking a given task.
 */
export function getIncompleteBlockerIds(tasks: Task[], task: Task): string[] {
  return task.blockedBy.filter((blockerId) => {
    const blocker = tasks.find((t) => t.id === blockerId);
    return blocker && !blocker.completed;
  });
}

/**
 * Check if a task has any incomplete children.
 * Parent tasks with incomplete children are not actionable.
 */
export function hasIncompleteChildren(tasks: Task[], task: Task): boolean {
  return task.children.some((childId) => {
    const child = tasks.find((t) => t.id === childId);
    return child && !child.completed;
  });
}

/**
 * Simple pluralization helper.
 */
export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? singular + "s");
}

/**
 * Exit with error if task is not found, showing a hint to list all tasks.
 * Returns the task (narrowed to non-null) if found.
 */
export async function exitIfTaskNotFound(
  task: Task | null,
  id: string,
  service: TaskService
): Promise<Task> {
  if (task) return task;
  console.error(`${colors.red}Error:${colors.reset} Task ${colors.bold}${id}${colors.reset} not found`);
  const allTasks = await service.list({ all: true });
  if (allTasks.length > 0) {
    console.error(`${colors.dim}Hint: Run "dex list --all" to see all tasks${colors.reset}`);
  }
  process.exit(1);
}

/**
 * Format an error for CLI output with proper coloring and suggestions.
 */
export function formatCliError(err: unknown): string {
  const { message, suggestion } = extractErrorInfo(err);
  let output = `${colors.red}Error:${colors.reset} ${message}`;
  if (suggestion) {
    output += `\n${colors.dim}Hint: ${suggestion}${colors.reset}`;
  }
  return output;
}

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
          matrix[i - 1][j] + 1
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

export function promptConfirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

export function formatAge(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Format a breadcrumb path from ancestors to current task.
 * Example: "Epic > Task > Subtask"
 */
export function formatBreadcrumb(ancestors: Task[], current: Task, maxDescLength: number = 30): string {
  const items = [...ancestors, current].map((t) =>
    truncateText(t.description, maxDescLength)
  );
  return items.join(` ${colors.dim}>${colors.reset} `);
}

/**
 * Strip ANSI color codes from a string for accurate length calculation.
 */
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Wrap text to fit within a specified width, with proper indentation for continuation lines.
 * Handles ANSI color codes correctly by not counting them toward line length.
 */
export function wrapText(text: string, width: number, indent: string = ""): string {
  if (!text) return "";

  const effectiveWidth = width - indent.length;
  if (effectiveWidth <= 10) {
    // Too narrow, just return with indent
    return indent + text;
  }

  const lines: string[] = [];
  // Split on existing newlines first
  const paragraphs = text.split(/\n/);

  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) {
      lines.push("");
      continue;
    }

    const words = paragraph.split(/\s+/);
    let currentLine = "";
    let currentVisibleLength = 0;

    for (const word of words) {
      if (!word) continue;

      const wordVisibleLength = stripAnsi(word).length;
      const separator = currentLine ? " " : "";
      const separatorLength = separator.length;

      if (currentVisibleLength + separatorLength + wordVisibleLength <= effectiveWidth) {
        currentLine += separator + word;
        currentVisibleLength += separatorLength + wordVisibleLength;
      } else {
        if (currentLine) {
          lines.push(currentLine);
        }
        // Handle very long words that exceed line width
        if (wordVisibleLength > effectiveWidth) {
          // Just add the word as-is, it will overflow but that's acceptable
          lines.push(word);
          currentLine = "";
          currentVisibleLength = 0;
        } else {
          currentLine = word;
          currentVisibleLength = wordVisibleLength;
        }
      }
    }

    if (currentLine) {
      lines.push(currentLine);
    }
  }

  return lines.map((line) => indent + line).join("\n");
}

/**
 * Truncate text to a maximum length, adding ellipsis if truncated.
 */
export function truncateText(text: string, maxLength: number): string {
  if (!text) return "";
  const visibleLength = stripAnsi(text).length;
  if (visibleLength <= maxLength) return text;
  if (maxLength <= 3) return "...";
  return text.slice(0, maxLength - 3) + "...";
}

export function formatTask(task: Task, options: FormatTaskOptions = {}): string {
  const { verbose = false, treePrefix = "", truncateDescription, blockedByIds } = options;

  const statusIcon = task.completed ? "[x]" : "[ ]";
  const statusColor = task.completed ? colors.green : colors.yellow;
  const priority = task.priority !== 1 ? ` ${colors.cyan}[p${task.priority}]${colors.reset}` : "";
  const completionAge = task.completed && task.completed_at
    ? ` ${colors.dim}(${formatAge(task.completed_at)})${colors.reset}`
    : "";

  // Show blocked indicator if task has incomplete blockers
  let blockedIndicator = "";
  if (blockedByIds && blockedByIds.length > 0) {
    if (blockedByIds.length === 1) {
      blockedIndicator = ` ${colors.red}[B: ${blockedByIds[0]}]${colors.reset}`;
    } else {
      blockedIndicator = ` ${colors.red}[B: ${blockedByIds.length}]${colors.reset}`;
    }
  }

  const description = truncateDescription
    ? truncateText(task.description, truncateDescription)
    : task.description;

  let output = `${treePrefix}${statusColor}${statusIcon}${colors.reset} ${colors.bold}${task.id}${colors.reset}${priority}${blockedIndicator}: ${description}${completionAge}`;

  if (verbose) {
    const labelWidth = 12;
    // For verbose output, create a continuation prefix that aligns with the tree
    const verbosePrefix = treePrefix
      .replace(/├── $/, "│   ")
      .replace(/└── $/, "    ");
    output += `\n${verbosePrefix}  ${"Context:".padEnd(labelWidth)} ${task.context}`;
    if (task.result) {
      output += `\n${verbosePrefix}  ${"Result:".padEnd(labelWidth)} ${colors.green}${task.result}${colors.reset}`;
    }
    if (task.metadata?.commit) {
      output += `\n${verbosePrefix}  ${"Commit:".padEnd(labelWidth)} ${colors.cyan}${task.metadata.commit.sha}${colors.reset}`;
    }
    output += `\n${verbosePrefix}  ${"Created:".padEnd(labelWidth)} ${colors.dim}${task.created_at}${colors.reset}`;
    output += `\n${verbosePrefix}  ${"Updated:".padEnd(labelWidth)} ${colors.dim}${task.updated_at}${colors.reset}`;
    if (task.completed_at) {
      output += `\n${verbosePrefix}  ${"Completed:".padEnd(labelWidth)} ${colors.dim}${task.completed_at}${colors.reset}`;
    }
  }

  return output;
}


export function getStringFlag(flags: ParsedArgs["flags"], name: string): string | undefined {
  const value = flags[name];
  // Treat empty strings as missing values (can happen when flag is at end of args)
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  return undefined;
}

export function getBooleanFlag(flags: ParsedArgs["flags"], name: string): boolean {
  return flags[name] === true;
}

export function parseIntFlag(flags: ParsedArgs["flags"], name: string): number | undefined {
  const value = getStringFlag(flags, name);
  if (value === undefined) {
    return undefined;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed)) {
    console.error(`${colors.red}Error:${colors.reset} Invalid value for --${name}: expected a number, got "${value}"`);
    process.exit(1);
  }
  return parsed;
}

/**
 * Suggest a similar flag name using Levenshtein distance.
 */
function getFlagSuggestion(input: string, flagDefs: Record<string, FlagConfig>): string | null {
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
  commandName?: string
): ParsedArgs {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const unknownFlags: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg.startsWith("--")) {
      const flagName = arg.slice(2);
      const flagConfig = flagDefs[flagName];

      if (flagConfig) {
        if (flagConfig.hasValue) {
          flags[flagName] = args[++i] || "";
        } else {
          flags[flagName] = true;
        }
      } else {
        // Unknown long flag
        unknownFlags.push(arg);
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      const shortFlag = arg.slice(1);
      const flagEntry = Object.entries(flagDefs).find(
        ([, config]) => config.short === shortFlag
      );

      if (flagEntry) {
        const [flagName, flagConfig] = flagEntry;
        if (flagConfig.hasValue) {
          flags[flagName] = args[++i] || "";
        } else {
          flags[flagName] = true;
        }
      } else {
        // Unknown short flag
        unknownFlags.push(arg);
      }
    } else if (arg.startsWith("-") && arg.length > 2) {
      // Unknown flag like -abc or --flag=value style not supported
      unknownFlags.push(arg);
    } else {
      positional.push(arg);
    }
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
    errorMsg += `\nRun '${colors.dim}${cmd} --help${colors.reset}' for usage.`;

    console.error(errorMsg);
    process.exit(1);
  }

  return { positional, flags };
}
