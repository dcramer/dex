/**
 * Get Shortcut API token from environment variable.
 * @param tokenEnv Environment variable name to check (default: SHORTCUT_API_TOKEN)
 * @returns Token string or null if not found
 */
export function getShortcutToken(
  tokenEnv: string = "SHORTCUT_API_TOKEN",
): string | null {
  const envToken = process.env[tokenEnv];
  if (envToken) {
    return envToken;
  }

  return null;
}
