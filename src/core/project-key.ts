import { createHash } from "node:crypto";
import { getGitRemoteUrl } from "./github/index.js";

function shortHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}

/**
 * Get the normalized project key for the current working directory.
 *
 * Resolution order:
 * 1. Git remote URL → normalized to "github.com-user-repo" format
 * 2. Fallback to path hash: "path-{sha256(cwd).slice(0,12)}"
 *
 * @param cwd Working directory (defaults to process.cwd())
 * @returns Normalized project key string
 */
export function getProjectKey(cwd: string = process.cwd()): string {
  // Try to get the git remote URL
  const remoteUrl = getGitRemoteUrl(cwd);
  if (remoteUrl) {
    return normalizeGitUrl(remoteUrl);
  }

  // Fallback to path hash
  return `path-${shortHash(cwd)}`;
}

/**
 * Normalize a git URL to a filesystem-safe project key.
 *
 * Examples:
 *   https://github.com/user/repo.git → github.com-user-repo
 *   git@github.com:user/repo.git → github.com-user-repo
 *   https://gitlab.com/user/repo → gitlab.com-user-repo
 */
function normalizeGitUrl(url: string): string {
  // Handle SSH URLs: git@github.com:user/repo.git
  const sshMatch = url.match(/^git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) {
    const host = sshMatch[1];
    const path = sshMatch[2];
    return `${host}-${path.replace(/\//g, "-")}`;
  }

  // Handle HTTPS URLs: https://github.com/user/repo.git
  try {
    const parsed = new URL(url);
    const host = parsed.host;
    const path = parsed.pathname
      .replace(/^\//, "")  // Remove leading slash
      .replace(/\.git$/, ""); // Remove .git suffix
    return `${host}-${path.replace(/\//g, "-")}`;
  } catch {
    // If URL parsing fails, hash the URL
    return `url-${shortHash(url)}`;
  }
}
