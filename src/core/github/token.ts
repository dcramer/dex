import { execSync } from "node:child_process";

/**
 * Get GitHub token from environment variable or gh CLI.
 * @param tokenEnv Environment variable name to check first (default: GITHUB_TOKEN)
 * @returns Token string or null if not found
 */
export function getGitHubToken(tokenEnv: string = "GITHUB_TOKEN"): string | null {
  // First try environment variable
  const envToken = process.env[tokenEnv];
  if (envToken) {
    return envToken;
  }

  // Fall back to gh CLI
  try {
    const token = execSync("gh auth token", {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (token) {
      return token;
    }
  } catch {
    // gh CLI not available or not authenticated
  }

  return null;
}
