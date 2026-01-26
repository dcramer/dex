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
  blue: useColors ? "\x1b[34m" : "",
  cyan: useColors ? "\x1b[36m" : "",
};

/**
 * Strip ANSI color codes from a string for accurate length calculation.
 */
export function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}
