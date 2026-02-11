import type { CliOptions } from "./utils.js";
import { createService, formatCliError } from "./utils.js";
import { colors } from "./colors.js";
import { getBooleanFlag, parseArgs } from "./args.js";
import type { GitHubRepo } from "../core/github/index.js";
import {
  getGitHubIssueNumber,
  getGitHubRepo,
  parseGitHubIssueRef,
  parseHierarchicalIssueBody,
  parseRootTaskMetadata,
  getGitHubToken,
} from "../core/github/index.js";
import {
  getShortcutStoryId,
  getShortcutToken,
  ShortcutApi,
  parseTaskMetadata as parseShortcutTaskMetadata,
  parseStoryDescription,
} from "../core/shortcut/index.js";
import { loadConfig } from "../core/config.js";
import type { Task, ShortcutMetadata } from "../types.js";
import { Octokit } from "@octokit/rest";

export async function importCommand(
  args: string[],
  options: CliOptions,
): Promise<void> {
  const { positional, flags } = parseArgs(
    args,
    {
      all: { hasValue: false },
      "dry-run": { hasValue: false },
      update: { hasValue: false },
      github: { hasValue: false },
      shortcut: { hasValue: false },
      help: { short: "h", hasValue: false },
    },
    "import",
  );

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex import${colors.reset} - Import GitHub Issues or Shortcut Stories as tasks

${colors.bold}USAGE:${colors.reset}
  dex import #123            # Import GitHub issue #123
  dex import sc#123          # Import Shortcut story #123
  dex import <url>           # Import by full URL
  dex import --all           # Import all dex-labeled items
  dex import --all --github  # Import only from GitHub
  dex import --all --shortcut # Import only from Shortcut
  dex import --dry-run       # Preview without importing
  dex import #123 --update   # Update existing task

${colors.bold}ARGUMENTS:${colors.reset}
  <ref>                   Reference format:
                          GitHub: #N, URL, or owner/repo#N
                          Shortcut: sc#N, SC#N, or full URL

${colors.bold}OPTIONS:${colors.reset}
  --all                   Import all items with dex label
  --github                Filter --all to only GitHub
  --shortcut              Filter --all to only Shortcut
  --update                Update existing task if already imported
  --dry-run               Show what would be imported without making changes
  -h, --help              Show this help message

${colors.bold}REQUIREMENTS:${colors.reset}
  GitHub:
    - Git repository with GitHub remote (for #N syntax)
    - GitHub authentication (GITHUB_TOKEN env var or 'gh auth login')

  Shortcut:
    - SHORTCUT_API_TOKEN environment variable

${colors.bold}EXAMPLE:${colors.reset}
  dex import #42                              # Import GitHub issue
  dex import sc#123                           # Import Shortcut story
  dex import https://github.com/user/repo/issues/42
  dex import https://app.shortcut.com/myorg/story/123
  dex import --all                            # Import all dex items
  dex import --all --shortcut                 # Import all from Shortcut
  dex import #42 --update                     # Refresh local task
`);
    return;
  }

  const ref = positional[0];
  const importAll = getBooleanFlag(flags, "all");
  const dryRun = getBooleanFlag(flags, "dry-run");
  const update = getBooleanFlag(flags, "update");
  const githubOnly = getBooleanFlag(flags, "github");
  const shortcutOnly = getBooleanFlag(flags, "shortcut");

  if (!ref && !importAll) {
    console.error(
      `${colors.red}Error:${colors.reset} Reference or --all required`,
    );
    console.error(
      `Usage: dex import #123, dex import sc#123, or dex import --all`,
    );
    process.exit(1);
  }

  const config = loadConfig({ storagePath: options.storage.getIdentifier() });
  const service = createService(options);

  try {
    if (importAll) {
      // Import all from GitHub and/or Shortcut
      const importFromGitHub = !shortcutOnly;
      const importFromShortcut = !githubOnly;

      if (importFromGitHub) {
        await importAllFromGitHub(service, config, dryRun, update);
      }

      if (importFromShortcut) {
        await importAllFromShortcut(service, config, dryRun, update);
      }
    } else {
      // Detect which service the reference is for
      const shortcutRef = parseShortcutRef(ref);

      if (shortcutRef) {
        await importShortcutStory(service, config, shortcutRef, dryRun, update);
      } else {
        await importGitHubIssue(service, config, ref, dryRun, update);
      }
    }
  } catch (err) {
    console.error(formatCliError(err));
    process.exit(1);
  }
}

/**
 * Parse a Shortcut story reference.
 * Supports: sc#123, SC#123, https://app.shortcut.com/{workspace}/story/123
 * Returns { storyId, workspace? } or null if not a Shortcut reference.
 */
function parseShortcutRef(
  ref: string,
): { storyId: number; workspace?: string } | null {
  // sc#123 or SC#123 format
  const scMatch = ref.match(/^sc#(\d+)$/i);
  if (scMatch) {
    return { storyId: parseInt(scMatch[1], 10) };
  }

  // Full URL format: https://app.shortcut.com/{workspace}/story/123
  const urlMatch = ref.match(
    /^https?:\/\/app\.shortcut\.com\/([^/]+)\/story\/(\d+)/i,
  );
  if (urlMatch) {
    return { storyId: parseInt(urlMatch[2], 10), workspace: urlMatch[1] };
  }

  return null;
}

// ============================================================
// GitHub Import Functions
// ============================================================

async function importGitHubIssue(
  service: ReturnType<typeof createService>,
  config: ReturnType<typeof loadConfig>,
  issueRef: string,
  dryRun: boolean,
  update: boolean,
): Promise<void> {
  const tokenEnv = config.sync?.github?.token_env || "GITHUB_TOKEN";
  const token = getGitHubToken(tokenEnv);

  if (!token) {
    console.error(
      `${colors.red}Error:${colors.reset} GitHub token not found.\n` +
        `Set the ${tokenEnv} environment variable: export ${tokenEnv}=ghp_...\n` +
        `Or authenticate with: gh auth login`,
    );
    process.exit(1);
  }

  const octokit = new Octokit({ auth: token });
  const defaultRepo = getGitHubRepo();
  const parsed = parseGitHubIssueRef(issueRef, defaultRepo ?? undefined);

  if (!parsed) {
    console.error(
      `${colors.red}Error:${colors.reset} Invalid issue reference: ${issueRef}`,
    );
    console.error(`Expected: #123, owner/repo#123, or full GitHub URL`);
    process.exit(1);
  }

  // Check if already imported
  const existingTasks = await service.list({ all: true });
  const alreadyImported = existingTasks.find(
    (t) => getGitHubIssueNumber(t) === parsed.number,
  );

  // Fetch the issue
  const { data: issue } = await octokit.issues.get({
    owner: parsed.owner,
    repo: parsed.repo,
    issue_number: parsed.number,
  });

  if (alreadyImported) {
    if (update) {
      if (dryRun) {
        console.log(
          `Would update task ${colors.bold}${alreadyImported.id}${colors.reset} ` +
            `from GitHub issue #${parsed.number}`,
        );
        return;
      }

      const updatedTask = await updateTaskFromGitHubIssue(
        service,
        alreadyImported,
        issue,
        parsed,
      );
      const subtaskResult = await importSubtasksFromIssueBody(
        service,
        issue.body || "",
        updatedTask.id,
        existingTasks,
      );
      console.log(
        `${colors.green}Updated${colors.reset} task ${colors.bold}${updatedTask.id}${colors.reset} ` +
          `from GitHub issue #${parsed.number}`,
      );
      if (subtaskResult.created > 0 || subtaskResult.updated > 0) {
        console.log(
          `  Subtasks: ${subtaskResult.created} created, ${subtaskResult.updated} updated`,
        );
      }
      return;
    }

    console.log(
      `${colors.yellow}Skipped${colors.reset} GitHub issue #${parsed.number}: ` +
        `already imported as task ${colors.bold}${alreadyImported.id}${colors.reset}\n` +
        `  Use --update to refresh from GitHub`,
    );
    return;
  }

  const body = issue.body || "";
  const { subtasks } = parseHierarchicalIssueBody(body);

  if (dryRun) {
    console.log(
      `Would import from GitHub ${colors.cyan}${parsed.owner}/${parsed.repo}${colors.reset}:`,
    );
    console.log(`  #${issue.number}: ${issue.title}`);
    if (subtasks.length > 0) {
      console.log(`  (${subtasks.length} subtasks)`);
    }
    return;
  }

  const task = await importGitHubIssueAsTask(service, issue, parsed);
  console.log(
    `${colors.green}Imported${colors.reset} issue #${parsed.number} as task ` +
      `${colors.bold}${task.id}${colors.reset}: "${task.name}"`,
  );

  const subtaskResult = await importSubtasksFromIssueBody(
    service,
    body,
    task.id,
    existingTasks,
  );
  if (subtaskResult.created > 0) {
    console.log(`  Created ${subtaskResult.created} subtask(s)`);
  }
}

async function importAllFromGitHub(
  service: ReturnType<typeof createService>,
  config: ReturnType<typeof loadConfig>,
  dryRun: boolean,
  update: boolean,
): Promise<void> {
  const tokenEnv = config.sync?.github?.token_env || "GITHUB_TOKEN";
  const token = getGitHubToken(tokenEnv);

  if (!token) {
    console.warn(
      `${colors.yellow}Warning:${colors.reset} GitHub token not found, skipping GitHub import.`,
    );
    return;
  }

  const repo = getGitHubRepo();
  if (!repo) {
    console.warn(
      `${colors.yellow}Warning:${colors.reset} No GitHub remote found, skipping GitHub import.`,
    );
    return;
  }

  const octokit = new Octokit({ auth: token });
  const labelPrefix = config.sync?.github?.label_prefix || "dex";

  // Fetch all issues with dex label
  const { data: issues } = await octokit.issues.listForRepo({
    owner: repo.owner,
    repo: repo.repo,
    labels: labelPrefix,
    state: "all",
    per_page: 100,
  });

  // Filter out pull requests
  const realIssues = issues.filter((i) => !i.pull_request);

  if (realIssues.length === 0) {
    console.log(
      `No GitHub issues with "${labelPrefix}" label found in ${repo.owner}/${repo.repo}.`,
    );
    return;
  }

  // Get existing tasks to check for duplicates
  const existingTasks = await service.list({ all: true });
  const importedByNumber = new Map(
    existingTasks
      .map((t) => [getGitHubIssueNumber(t), t] as const)
      .filter((pair): pair is [number, Task] => pair[0] !== null),
  );

  const toImport = realIssues.filter((i) => !importedByNumber.has(i.number));
  const toUpdate = update
    ? realIssues.filter((i) => importedByNumber.has(i.number))
    : [];
  const skipped = realIssues.length - toImport.length - toUpdate.length;

  if (dryRun) {
    if (toImport.length > 0) {
      console.log(
        `Would import ${toImport.length} GitHub issue(s) from ${colors.cyan}${repo.owner}/${repo.repo}${colors.reset}:`,
      );
      for (const issue of toImport) {
        const { subtasks } = parseHierarchicalIssueBody(issue.body || "");
        console.log(`  #${issue.number}: ${issue.title}`);
        if (subtasks.length > 0) {
          console.log(`    (${subtasks.length} subtasks)`);
        }
      }
    }
    if (toUpdate.length > 0) {
      console.log(
        `Would update ${toUpdate.length} task(s) from GitHub ${colors.cyan}${repo.owner}/${repo.repo}${colors.reset}:`,
      );
      for (const issue of toUpdate) {
        const existingTask = importedByNumber.get(issue.number)!;
        console.log(`  #${issue.number} → ${existingTask.id}`);
      }
    }
    if (skipped > 0) {
      console.log(`  (${skipped} already imported, use --update to refresh)`);
    }
    return;
  }

  let imported = 0;
  let updated = 0;

  for (const issue of toImport) {
    const task = await importGitHubIssueAsTask(service, issue, repo);
    const subtaskResult = await importSubtasksFromIssueBody(
      service,
      issue.body || "",
      task.id,
      existingTasks,
    );
    console.log(
      `${colors.green}Imported${colors.reset} GitHub #${issue.number} as ${colors.bold}${task.id}${colors.reset}`,
    );
    if (subtaskResult.created > 0) {
      console.log(`  Created ${subtaskResult.created} subtask(s)`);
    }
    imported++;
  }

  for (const issue of toUpdate) {
    const existingTask = importedByNumber.get(issue.number)!;
    await updateTaskFromGitHubIssue(service, existingTask, issue, repo);
    const subtaskResult = await importSubtasksFromIssueBody(
      service,
      issue.body || "",
      existingTask.id,
      existingTasks,
    );
    console.log(
      `${colors.green}Updated${colors.reset} GitHub #${issue.number} → ${colors.bold}${existingTask.id}${colors.reset}`,
    );
    if (subtaskResult.created > 0 || subtaskResult.updated > 0) {
      console.log(
        `  Subtasks: ${subtaskResult.created} created, ${subtaskResult.updated} updated`,
      );
    }
    updated++;
  }

  console.log(
    `\nGitHub: Imported ${imported}, updated ${updated} issue(s) from ${colors.cyan}${repo.owner}/${repo.repo}${colors.reset}`,
  );
  if (skipped > 0) {
    console.log(
      `Skipped ${skipped} already imported (use --update to refresh)`,
    );
  }
}

type GitHubIssue = {
  number: number;
  title: string;
  body?: string | null;
  state: string;
};

interface ParsedGitHubIssueData {
  cleanDescription: string;
  rootMetadata: ReturnType<typeof parseRootTaskMetadata>;
  githubMetadata: {
    issueNumber: number;
    issueUrl: string;
    repo: string;
  };
}

function parseGitHubIssueData(
  issue: GitHubIssue,
  repo: GitHubRepo,
): ParsedGitHubIssueData {
  const body = issue.body || "";
  const { description } = parseHierarchicalIssueBody(body);

  // Remove dex:task: comments (both new format dex:task:key:value and legacy dex:task:id)
  const cleanDescription = description
    .replace(/<!-- dex:task:[^\s]+ -->\n?/g, "")
    .trim();

  const rootMetadata = parseRootTaskMetadata(body);
  const repoString = `${repo.owner}/${repo.repo}`;

  return {
    cleanDescription,
    rootMetadata,
    githubMetadata: {
      issueNumber: issue.number,
      issueUrl: `https://github.com/${repoString}/issues/${issue.number}`,
      repo: repoString,
    },
  };
}

/**
 * Parse and create/update subtasks from a GitHub issue body.
 * Reusable across single import, bulk import, and update flows.
 */
async function importSubtasksFromIssueBody(
  service: ReturnType<typeof createService>,
  issueBody: string,
  parentTaskId: string,
  preloadedTasks?: Task[],
): Promise<{ created: number; updated: number }> {
  const { subtasks } = parseHierarchicalIssueBody(issueBody);
  if (subtasks.length === 0) {
    return { created: 0, updated: 0 };
  }

  const existingTasks = preloadedTasks ?? (await service.list({ all: true }));
  const existingById = new Map(existingTasks.map((t) => [t.id, t]));
  const idMapping = new Map<string, string>();
  let created = 0;
  let updated = 0;

  for (const subtask of subtasks) {
    const localParentId = subtask.parentId
      ? idMapping.get(subtask.parentId) || parentTaskId
      : parentTaskId;

    const existing = existingById.get(subtask.id);
    if (existing) {
      await service.update({
        id: existing.id,
        name: subtask.name,
        description: subtask.description || existing.description,
        parent_id: localParentId,
        priority: subtask.priority,
        completed: subtask.completed,
        started_at: subtask.started_at,
        result: subtask.result ?? undefined,
        metadata: subtask.metadata ?? undefined,
      });
      idMapping.set(subtask.id, existing.id);
      updated++;
    } else {
      const createdSubtask = await service.create({
        id: subtask.id,
        name: subtask.name,
        description: subtask.description || "Imported from GitHub issue",
        parent_id: localParentId,
        priority: subtask.priority,
        completed: subtask.completed,
        result: subtask.result,
        created_at: subtask.created_at,
        updated_at: subtask.updated_at,
        started_at: subtask.started_at,
        completed_at: subtask.completed_at,
        metadata: subtask.metadata,
      });
      idMapping.set(subtask.id, createdSubtask.id);
      created++;
    }
  }

  return { created, updated };
}

async function importGitHubIssueAsTask(
  service: ReturnType<typeof createService>,
  issue: GitHubIssue,
  repo: GitHubRepo,
): Promise<Task> {
  const { cleanDescription, rootMetadata, githubMetadata } =
    parseGitHubIssueData(issue, repo);

  const completed = rootMetadata?.completed ?? issue.state === "closed";

  const metadata = {
    github: githubMetadata,
    commit: rootMetadata?.commit,
  };

  return await service.create({
    id: rootMetadata?.id, // Use original ID if available (will fail if conflict)
    name: issue.title,
    description:
      cleanDescription || `Imported from GitHub issue #${issue.number}`,
    priority: rootMetadata?.priority,
    completed,
    result:
      rootMetadata?.result ??
      (completed ? "Imported as completed from GitHub" : null),
    metadata,
    created_at: rootMetadata?.created_at,
    updated_at: rootMetadata?.updated_at,
    started_at: rootMetadata?.started_at,
    completed_at: rootMetadata?.completed_at,
  });
}

async function updateTaskFromGitHubIssue(
  service: ReturnType<typeof createService>,
  existingTask: Task,
  issue: GitHubIssue,
  repo: GitHubRepo,
): Promise<Task> {
  const { cleanDescription, rootMetadata, githubMetadata } =
    parseGitHubIssueData(issue, repo);

  const isClosed = issue.state === "closed";

  return await service.update({
    id: existingTask.id,
    name: issue.title,
    description: cleanDescription || existingTask.description,
    priority: rootMetadata?.priority ?? existingTask.priority,
    metadata: {
      ...existingTask.metadata,
      github: githubMetadata,
      commit: rootMetadata?.commit,
    },
    completed: isClosed,
    result: isClosed
      ? rootMetadata?.result ||
        existingTask.result ||
        "Updated from closed GitHub issue"
      : undefined,
  });
}

// ============================================================
// Shortcut Import Functions
// ============================================================

async function importShortcutStory(
  service: ReturnType<typeof createService>,
  config: ReturnType<typeof loadConfig>,
  ref: { storyId: number; workspace?: string },
  dryRun: boolean,
  update: boolean,
): Promise<void> {
  const tokenEnv = config.sync?.shortcut?.token_env || "SHORTCUT_API_TOKEN";
  const token = getShortcutToken(tokenEnv);

  if (!token) {
    console.error(
      `${colors.red}Error:${colors.reset} Shortcut API token not found.\n` +
        `Set the ${tokenEnv} environment variable.`,
    );
    process.exit(1);
  }

  const api = new ShortcutApi(token);

  // Fetch the story
  const story = await api.getStory(ref.storyId);
  const workspace = ref.workspace || (await api.getWorkspaceSlug());

  // Check if already imported
  const existingTasks = await service.list({ all: true });
  const alreadyImported = existingTasks.find(
    (t) => getShortcutStoryId(t) === story.id,
  );

  if (alreadyImported) {
    if (update) {
      if (dryRun) {
        console.log(
          `Would update task ${colors.bold}${alreadyImported.id}${colors.reset} ` +
            `from Shortcut story #${story.id}`,
        );
        return;
      }

      const updatedTask = await updateTaskFromShortcutStory(
        service,
        alreadyImported,
        story,
        workspace,
      );
      console.log(
        `${colors.green}Updated${colors.reset} task ${colors.bold}${updatedTask.id}${colors.reset} ` +
          `from Shortcut story #${story.id}`,
      );
      return;
    }

    console.log(
      `${colors.yellow}Skipped${colors.reset} Shortcut story #${story.id}: ` +
        `already imported as task ${colors.bold}${alreadyImported.id}${colors.reset}\n` +
        `  Use --update to refresh from Shortcut`,
    );
    return;
  }

  if (dryRun) {
    console.log(
      `Would import from Shortcut ${colors.cyan}${workspace}${colors.reset}:`,
    );
    console.log(`  #${story.id}: ${story.name}`);
    return;
  }

  const task = await importShortcutStoryAsTask(service, story, workspace);
  console.log(
    `${colors.green}Imported${colors.reset} Shortcut story #${story.id} as task ` +
      `${colors.bold}${task.id}${colors.reset}: "${task.name}"`,
  );
}

async function importAllFromShortcut(
  service: ReturnType<typeof createService>,
  config: ReturnType<typeof loadConfig>,
  dryRun: boolean,
  update: boolean,
): Promise<void> {
  const tokenEnv = config.sync?.shortcut?.token_env || "SHORTCUT_API_TOKEN";
  const token = getShortcutToken(tokenEnv);

  if (!token) {
    console.warn(
      `${colors.yellow}Warning:${colors.reset} Shortcut API token not found, skipping Shortcut import.`,
    );
    return;
  }

  const api = new ShortcutApi(token);
  const label = config.sync?.shortcut?.label || "dex";
  const workspace =
    config.sync?.shortcut?.workspace || (await api.getWorkspaceSlug());

  // Search for stories with dex label
  const response = await api.searchStories(`label:"${label}"`);
  const stories = response.data;

  if (stories.length === 0) {
    console.log(
      `No Shortcut stories with "${label}" label found in ${workspace}.`,
    );
    return;
  }

  // Get existing tasks to check for duplicates
  const existingTasks = await service.list({ all: true });
  const importedById = new Map(
    existingTasks
      .map((t) => [getShortcutStoryId(t), t] as const)
      .filter((pair): pair is [number, Task] => pair[0] !== null),
  );

  const toImport = stories.filter((s) => !importedById.has(s.id));
  const toUpdate = update ? stories.filter((s) => importedById.has(s.id)) : [];
  const skipped = stories.length - toImport.length - toUpdate.length;

  if (dryRun) {
    if (toImport.length > 0) {
      console.log(
        `Would import ${toImport.length} Shortcut story(ies) from ${colors.cyan}${workspace}${colors.reset}:`,
      );
      for (const story of toImport) {
        console.log(`  #${story.id}: ${story.name}`);
      }
    }
    if (toUpdate.length > 0) {
      console.log(
        `Would update ${toUpdate.length} task(s) from Shortcut ${colors.cyan}${workspace}${colors.reset}:`,
      );
      for (const story of toUpdate) {
        const existingTask = importedById.get(story.id)!;
        console.log(`  #${story.id} → ${existingTask.id}`);
      }
    }
    if (skipped > 0) {
      console.log(`  (${skipped} already imported, use --update to refresh)`);
    }
    return;
  }

  let imported = 0;
  let updated = 0;

  for (const story of toImport) {
    const task = await importShortcutStoryAsTask(service, story, workspace);
    console.log(
      `${colors.green}Imported${colors.reset} Shortcut #${story.id} as ${colors.bold}${task.id}${colors.reset}`,
    );
    imported++;
  }

  for (const story of toUpdate) {
    const existingTask = importedById.get(story.id)!;
    await updateTaskFromShortcutStory(service, existingTask, story, workspace);
    console.log(
      `${colors.green}Updated${colors.reset} Shortcut #${story.id} → ${colors.bold}${existingTask.id}${colors.reset}`,
    );
    updated++;
  }

  console.log(
    `\nShortcut: Imported ${imported}, updated ${updated} story(ies) from ${colors.cyan}${workspace}${colors.reset}`,
  );
  if (skipped > 0) {
    console.log(
      `Skipped ${skipped} already imported (use --update to refresh)`,
    );
  }
}

type ShortcutStory = {
  id: number;
  name: string;
  description?: string;
  completed: boolean;
  app_url: string;
};

interface ParsedShortcutStoryData {
  cleanDescription: string;
  taskMetadata: ReturnType<typeof parseShortcutTaskMetadata>;
  shortcutMetadata: ShortcutMetadata;
}

function parseShortcutStoryData(
  story: ShortcutStory,
  workspace: string,
): ParsedShortcutStoryData {
  const { context: cleanDescription, metadata: taskMetadata } =
    parseStoryDescription(story.description ?? "");

  const shortcutMetadata: ShortcutMetadata = {
    storyId: story.id,
    storyUrl: story.app_url,
    workspace,
    state: story.completed ? "done" : "unstarted",
  };

  return {
    cleanDescription,
    taskMetadata,
    shortcutMetadata,
  };
}

async function importShortcutStoryAsTask(
  service: ReturnType<typeof createService>,
  story: ShortcutStory,
  workspace: string,
): Promise<Task> {
  const { cleanDescription, taskMetadata, shortcutMetadata } =
    parseShortcutStoryData(story, workspace);

  const completed = taskMetadata?.completed ?? story.completed;

  const metadata = {
    shortcut: shortcutMetadata,
    commit: taskMetadata?.commit,
  };

  return await service.create({
    id: taskMetadata?.id,
    name: story.name,
    description:
      cleanDescription || `Imported from Shortcut story #${story.id}`,
    priority: taskMetadata?.priority,
    completed,
    result:
      taskMetadata?.result ??
      (completed ? "Imported as completed from Shortcut" : null),
    metadata,
    created_at: taskMetadata?.created_at,
    updated_at: taskMetadata?.updated_at,
    completed_at: taskMetadata?.completed_at,
  });
}

async function updateTaskFromShortcutStory(
  service: ReturnType<typeof createService>,
  existingTask: Task,
  story: ShortcutStory,
  workspace: string,
): Promise<Task> {
  const { cleanDescription, taskMetadata, shortcutMetadata } =
    parseShortcutStoryData(story, workspace);

  return await service.update({
    id: existingTask.id,
    name: story.name,
    description: cleanDescription || existingTask.description,
    priority: taskMetadata?.priority ?? existingTask.priority,
    metadata: {
      ...existingTask.metadata,
      shortcut: shortcutMetadata,
      commit: taskMetadata?.commit,
    },
    completed: story.completed,
    result: story.completed
      ? taskMetadata?.result ||
        existingTask.result ||
        "Updated from completed Shortcut story"
      : undefined,
  });
}
