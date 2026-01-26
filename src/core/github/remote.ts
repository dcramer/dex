import { execSync } from "node:child_process";

/**
 * GitHub repository reference.
 */
export interface GitHubRepo {
  owner: string;
  repo: string;
}

/**
 * Get the origin remote URL from git, if available.
 * @param cwd Working directory (defaults to process.cwd())
 */
export function getGitRemoteUrl(cwd: string = process.cwd()): string | null {
  try {
    const result = execSync("git config --get remote.origin.url", {
      cwd,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return result.trim() || null;
  } catch {
    return null;
  }
}

/**
 * Parse a GitHub repository from a git remote URL.
 * Returns null for non-GitHub remotes.
 *
 * Supported formats:
 *   https://github.com/owner/repo.git → { owner, repo }
 *   git@github.com:owner/repo.git → { owner, repo }
 *   https://github.com/owner/repo → { owner, repo }
 *
 * @param url Git remote URL
 */
export function parseGitHubUrl(url: string): GitHubRepo | null {
  // Handle SSH URLs: git@github.com:owner/repo.git
  const sshMatch = url.match(/^git@github\.com:([^/]+)\/(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  // Handle HTTPS URLs: https://github.com/owner/repo.git
  try {
    const parsed = new URL(url);
    if (parsed.host !== "github.com") {
      return null;
    }
    const parts = parsed.pathname
      .replace(/^\//, "")
      .replace(/\.git$/, "")
      .split("/");
    if (parts.length >= 2) {
      return { owner: parts[0], repo: parts[1] };
    }
  } catch {
    // URL parsing failed
  }

  return null;
}

/**
 * Get the GitHub repository from the current git remote.
 * Returns null if not in a git repo or remote is not GitHub.
 *
 * @param cwd Working directory (defaults to process.cwd())
 */
export function getGitHubRepo(cwd: string = process.cwd()): GitHubRepo | null {
  const remoteUrl = getGitRemoteUrl(cwd);
  if (!remoteUrl) {
    return null;
  }
  return parseGitHubUrl(remoteUrl);
}

/**
 * Parse a GitHub issue reference into owner, repo, and issue number.
 *
 * Supported formats:
 *   #123 → { number: 123 } (owner/repo must be provided separately)
 *   https://github.com/owner/repo/issues/123 → { owner, repo, number: 123 }
 *   owner/repo#123 → { owner, repo, number: 123 }
 */
export function parseGitHubIssueRef(
  ref: string,
  defaultRepo?: GitHubRepo
): { owner: string; repo: string; number: number } | null {
  // Full URL: https://github.com/owner/repo/issues/123
  const urlMatch = ref.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/
  );
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: urlMatch[2],
      number: parseInt(urlMatch[3], 10),
    };
  }

  // Shorthand: owner/repo#123
  const shortMatch = ref.match(/^([^/]+)\/([^#]+)#(\d+)$/);
  if (shortMatch) {
    return {
      owner: shortMatch[1],
      repo: shortMatch[2],
      number: parseInt(shortMatch[3], 10),
    };
  }

  // Just number: #123 or 123
  const numberMatch = ref.match(/^#?(\d+)$/);
  if (numberMatch && defaultRepo) {
    return {
      owner: defaultRepo.owner,
      repo: defaultRepo.repo,
      number: parseInt(numberMatch[1], 10),
    };
  }

  return null;
}
