import { GitHubSyncService } from "./sync.js";
import type { GitHubSyncConfig } from "../config.js";
import { getGitHubRepo } from "./remote.js";
import { getGitHubToken } from "./token.js";

/**
 * Create a GitHubSyncService for auto-sync if enabled in config.
 * Returns null if auto-sync is disabled, no git remote, or no token.
 *
 * @param config Sync config from dex.toml
 * @param storagePath Path to task storage (default: ".dex")
 */
export async function createGitHubSyncService(
  config: GitHubSyncConfig | undefined,
  storagePath?: string,
): Promise<GitHubSyncService | null> {
  if (!config?.enabled) {
    return null;
  }

  const repo = getGitHubRepo();
  if (!repo) {
    console.warn(
      "GitHub sync enabled but no GitHub remote found. Sync disabled.",
    );
    return null;
  }

  const tokenEnv = config.token_env || "GITHUB_TOKEN";
  const token = getGitHubToken(tokenEnv);

  if (!token) {
    console.warn(
      `GitHub sync enabled but no token found (checked ${tokenEnv} and gh CLI). Sync disabled.`,
    );
    return null;
  }

  return new GitHubSyncService({
    repo,
    token,
    labelPrefix: config.label_prefix,
    storagePath,
  });
}

/**
 * Create a GitHubSyncService for manual sync/import commands.
 * Throws descriptive errors if requirements are not met.
 *
 * @param config Optional sync config for label_prefix and token_env
 * @param storagePath Path to task storage (default: ".dex")
 */
export async function createGitHubSyncServiceOrThrow(
  config?: GitHubSyncConfig,
  storagePath?: string,
): Promise<GitHubSyncService> {
  const repo = getGitHubRepo();
  if (!repo) {
    throw new Error(
      "Cannot determine GitHub repository.\n" +
        "This directory is not in a git repository with a GitHub remote.",
    );
  }

  const tokenEnv = config?.token_env || "GITHUB_TOKEN";
  const token = getGitHubToken(tokenEnv);

  if (!token) {
    throw new Error(
      `GitHub token not found.\n` +
        `Set ${tokenEnv} environment variable or authenticate with: gh auth login`,
    );
  }

  return new GitHubSyncService({
    repo,
    token,
    labelPrefix: config?.label_prefix,
    storagePath,
  });
}
