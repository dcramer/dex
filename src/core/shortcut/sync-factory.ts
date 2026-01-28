import { ShortcutSyncService } from "./sync.js";
import type { ShortcutSyncConfig } from "../config.js";
import { getShortcutToken } from "./token.js";
import { ShortcutApi } from "./api.js";

/**
 * Create a ShortcutSyncService for auto-sync if enabled in config.
 * Returns null if auto-sync is disabled or no token.
 *
 * @param config Sync config from dex.toml
 */
export async function createShortcutSyncService(
  config: ShortcutSyncConfig | undefined,
): Promise<ShortcutSyncService | null> {
  if (!config?.enabled) {
    return null;
  }

  const tokenEnv = config.token_env || "SHORTCUT_API_TOKEN";
  const token = getShortcutToken(tokenEnv);

  if (!token) {
    console.warn(
      `Shortcut sync enabled but no token found (checked ${tokenEnv}). Sync disabled.`,
    );
    return null;
  }

  if (!config.team) {
    console.warn(
      "Shortcut sync enabled but no team specified in config. Sync disabled.",
    );
    return null;
  }

  // Get workspace from config or API
  let workspace = config.workspace;
  if (!workspace) {
    try {
      const api = new ShortcutApi(token);
      workspace = await api.getWorkspaceSlug();
    } catch (err) {
      console.warn(
        `Failed to fetch Shortcut workspace: ${err}. Sync disabled.`,
      );
      return null;
    }
  }

  return new ShortcutSyncService({
    token,
    workspace,
    team: config.team,
    workflow: config.workflow,
    label: config.label,
  });
}

/**
 * Create a ShortcutSyncService for manual sync/import commands.
 * Throws descriptive errors if requirements are not met.
 *
 * @param config Optional sync config for label and token_env
 */
export async function createShortcutSyncServiceOrThrow(
  config?: ShortcutSyncConfig,
): Promise<ShortcutSyncService> {
  const tokenEnv = config?.token_env || "SHORTCUT_API_TOKEN";
  const token = getShortcutToken(tokenEnv);

  if (!token) {
    throw new Error(
      `Shortcut API token not found.\n` +
        `Set the ${tokenEnv} environment variable.`,
    );
  }

  if (!config?.team) {
    throw new Error(
      `Shortcut team not configured.\n` +
        `Add 'team' to [sync.shortcut] section in dex.toml.`,
    );
  }

  // Get workspace from config or API
  let workspace = config.workspace;
  if (!workspace) {
    const api = new ShortcutApi(token);
    workspace = await api.getWorkspaceSlug();
  }

  return new ShortcutSyncService({
    token,
    workspace,
    team: config.team,
    workflow: config.workflow,
    label: config.label,
  });
}
