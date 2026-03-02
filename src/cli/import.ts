import * as fs from "node:fs";
import * as path from "node:path";
import type { CliOptions } from "./utils.js";
import { createService, formatCliError } from "./utils.js";
import { colors } from "./colors.js";
import { getBooleanFlag, getStringFlag, parseArgs } from "./args.js";
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
import {
  parseBeadsExportJsonl,
  type ParsedBeadsIssue,
} from "../core/beads/index.js";
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
      beads: { hasValue: true },
      github: { hasValue: false },
      shortcut: { hasValue: false },
      help: { short: "h", hasValue: false },
    },
    "import",
  );

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex import${colors.reset} - Import GitHub, Shortcut, or Beads items as tasks

${colors.bold}USAGE:${colors.reset}
  dex import #123                             # Import GitHub issue #123
  dex import sc#123                           # Import Shortcut story #123
  dex import --beads data.jsonl               # Import all issues from Beads export
  dex import --beads data.jsonl id1 id2       # Import selected Beads issues + descendants
  dex import <url>                            # Import by full URL
  dex import --all                            # Import all dex-labeled items
  dex import --all --github                   # Import only from GitHub
  dex import --all --shortcut                 # Import only from Shortcut
  dex import --dry-run                        # Preview without importing
  dex import #123 --update                    # Update existing task

${colors.bold}ARGUMENTS:${colors.reset}
  <ref>                      Reference format (ref mode only):
                             GitHub: #N, URL, or owner/repo#N
                             Shortcut: sc#N, SC#N, or full URL
  [issue-id...]              Optional Beads issue IDs (beads mode only)
                             Imports each selected issue and all descendants

${colors.bold}OPTIONS:${colors.reset}
  --all                      Import all items with dex label
  --beads <path>             Import from Beads JSONL export file
  --github                   Filter --all to only GitHub
  --shortcut                 Filter --all to only Shortcut
  --update                   Update existing task if already imported
  --dry-run                  Show what would be imported without making changes
  -h, --help                 Show this help message

${colors.bold}REQUIREMENTS:${colors.reset}
  GitHub:
    - Git repository with GitHub remote (for #N syntax)
    - GitHub authentication (GITHUB_TOKEN env var or 'gh auth login')

  Shortcut:
    - SHORTCUT_API_TOKEN environment variable

  Beads:
    - Local JSONL export file (for example from 'bd export')

${colors.bold}EXAMPLE:${colors.reset}
  dex import #42                              # Import GitHub issue
  dex import sc#123                           # Import Shortcut story
  dex import --beads ~/tmp/beads.jsonl        # Import all from Beads
  dex import --beads ~/tmp/beads.jsonl i1 i2  # Import selected Beads issues + descendants
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
  const beadsFile = getStringFlag(flags, "beads");
  const beadsIssueIds = beadsFile ? positional : [];
  const dryRun = getBooleanFlag(flags, "dry-run");
  const update = getBooleanFlag(flags, "update");
  const githubOnly = getBooleanFlag(flags, "github");
  const shortcutOnly = getBooleanFlag(flags, "shortcut");

  if (beadsFile) {
    if (importAll || githubOnly || shortcutOnly) {
      console.error(
        `${colors.red}Error:${colors.reset} --beads cannot be combined with --all, --github, or --shortcut`,
      );
      console.error(
        `Usage: dex import --beads <path> [issue-id...] [--update] [--dry-run]`,
      );
      process.exit(1);
    }
  }

  if (!ref && !importAll && !beadsFile) {
    console.error(
      `${colors.red}Error:${colors.reset} Reference or --all required`,
    );
    console.error(
      `Usage: dex import #123, dex import sc#123, dex import --all, or dex import --beads <path> [issue-id...]`,
    );
    process.exit(1);
  }

  const config = loadConfig({ storagePath: options.storage.getIdentifier() });
  const service = createService(options);

  try {
    if (beadsFile) {
      await importFromBeadsFile(
        service,
        beadsFile,
        dryRun,
        update,
        beadsIssueIds,
      );
    } else if (importAll) {
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
// Beads Import Functions
// ============================================================

async function importFromBeadsFile(
  service: ReturnType<typeof createService>,
  filePath: string,
  dryRun: boolean,
  update: boolean,
  requestedIssueIds: string[] = [],
): Promise<void> {
  const resolvedPath = path.resolve(filePath);

  let input: string;
  try {
    input = fs.readFileSync(resolvedPath, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read Beads file ${resolvedPath}: ${message}`);
  }

  const parsed = parseBeadsExportJsonl(input);
  const parseWarnings = [...parsed.warnings];

  if (parsed.issues.length === 0) {
    console.log(`No Beads issues found in ${resolvedPath}.`);
    if (parseWarnings.length > 0) {
      printBeadsWarnings(parseWarnings);
    }
    return;
  }

  const issuesToImport = selectBeadsIssues(parsed.issues, requestedIssueIds);

  const existingTasks = await service.list({ all: true });
  const existingById = new Map(existingTasks.map((task) => [task.id, task]));

  const toCreate = issuesToImport.filter(
    (issue) => !existingById.has(issue.id),
  );
  const toExisting = issuesToImport.filter((issue) =>
    existingById.has(issue.id),
  );

  if (dryRun) {
    const wouldUpdate = update ? toExisting.length : 0;
    const wouldSkip = update ? 0 : toExisting.length;

    console.log(
      `Would import ${toCreate.length} and update ${wouldUpdate} task(s) from Beads file ${colors.cyan}${resolvedPath}${colors.reset}`,
    );
    if (wouldSkip > 0) {
      console.log(
        `Would skip ${wouldSkip} existing task(s) (use --update to refresh)`,
      );
    }

    if (parseWarnings.length > 0) {
      printBeadsWarnings(parseWarnings);
    }
    return;
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;
  const createdIds = new Set<string>();

  for (const issue of issuesToImport) {
    const existing = existingById.get(issue.id);

    if (existing) {
      if (!update) {
        skipped++;
        continue;
      }

      await service.update({
        id: issue.id,
        name: issue.name,
        description: issue.description,
        priority: issue.priority,
        completed: issue.completed,
        ...(!issue.completed
          ? { completed_at: null }
          : issue.completed_at
            ? { completed_at: issue.completed_at }
            : {}),
        result: issue.completed ? issue.result : null,
        started_at: issue.started_at ?? null,
        metadata: {
          ...(existing.metadata ?? {}),
          beads: issue.beadsMetadata,
        },
      });
      updated++;
      continue;
    }

    await service.create({
      id: issue.id,
      name: issue.name,
      description: issue.description,
      priority: issue.priority,
      completed: issue.completed,
      result: issue.result,
      created_at: issue.created_at,
      updated_at: issue.updated_at,
      started_at: issue.started_at,
      completed_at: issue.completed_at,
      metadata: {
        beads: issue.beadsMetadata,
      },
    });
    createdIds.add(issue.id);
    created++;
  }

  const relationshipWarnings = [...parseWarnings];
  const currentTasks = await service.list({ all: true });
  const currentById = new Map(currentTasks.map((task) => [task.id, task]));

  for (const issue of issuesToImport) {
    const shouldApplyRelationships =
      createdIds.has(issue.id) || (update && existingById.has(issue.id));
    if (!shouldApplyRelationships) continue;

    const current = currentById.get(issue.id);
    if (!current) {
      relationshipWarnings.push(
        `Issue ${issue.id}: task was not found after import; skipping relationship sync`,
      );
      continue;
    }

    const desiredParent = issue.parentId ?? null;
    if (desiredParent !== current.parent_id) {
      if (desiredParent && !currentById.has(desiredParent)) {
        relationshipWarnings.push(
          `Issue ${issue.id}: parent ${desiredParent} is missing, skipping parent link`,
        );
      } else {
        try {
          await service.update({ id: issue.id, parent_id: desiredParent });
          current.parent_id = desiredParent;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          relationshipWarnings.push(
            `Issue ${issue.id}: could not set parent to ${desiredParent ?? "(none)"}: ${message}`,
          );
        }
      }
    }

    const desiredBlockers: string[] = [];
    for (const blockerId of issue.blockerIds) {
      if (blockerId === issue.id) {
        relationshipWarnings.push(
          `Issue ${issue.id}: self-blocking dependency ignored`,
        );
        continue;
      }
      if (!currentById.has(blockerId)) {
        relationshipWarnings.push(
          `Issue ${issue.id}: blocker ${blockerId} missing, skipping blocker link`,
        );
        continue;
      }
      desiredBlockers.push(blockerId);
    }

    const currentBlockers = new Set(current.blockedBy);
    const desiredSet = new Set(desiredBlockers);

    const addBlockedBy = [...desiredSet].filter(
      (id) => !currentBlockers.has(id),
    );
    const removeBlockedBy = update
      ? [...currentBlockers].filter((id) => !desiredSet.has(id))
      : [];

    if (addBlockedBy.length > 0 || removeBlockedBy.length > 0) {
      try {
        await service.update({
          id: issue.id,
          ...(addBlockedBy.length > 0 && { add_blocked_by: addBlockedBy }),
          ...(removeBlockedBy.length > 0 && {
            remove_blocked_by: removeBlockedBy,
          }),
        });

        const nextBlockedBy = [
          ...current.blockedBy.filter((id) => !removeBlockedBy.includes(id)),
          ...addBlockedBy,
        ];
        current.blockedBy = Array.from(new Set(nextBlockedBy));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        relationshipWarnings.push(
          `Issue ${issue.id}: could not update blockers: ${message}`,
        );
      }
    }
  }

  console.log(
    `Beads: Imported ${created}, updated ${updated} task(s) from ${colors.cyan}${resolvedPath}${colors.reset}`,
  );
  if (skipped > 0) {
    console.log(
      `Skipped ${skipped} existing task(s) (use --update to refresh)`,
    );
  }

  if (relationshipWarnings.length > 0) {
    printBeadsWarnings(relationshipWarnings);
  }
}

function selectBeadsIssues(
  issues: ParsedBeadsIssue[],
  requestedIssueIds: string[],
): ParsedBeadsIssue[] {
  const normalizedRequested = Array.from(
    new Set(requestedIssueIds.map((id) => id.trim()).filter(Boolean)),
  );

  if (normalizedRequested.length === 0) {
    return issues;
  }

  const issueById = new Map(issues.map((issue) => [issue.id, issue]));
  const missingIssueIds = normalizedRequested.filter(
    (id) => !issueById.has(id),
  );
  if (missingIssueIds.length > 0) {
    throw new Error(
      `Beads issue id(s) not found in export: ${missingIssueIds.join(", ")}`,
    );
  }

  const childrenByParent = new Map<string, string[]>();
  for (const issue of issues) {
    if (!issue.parentId) continue;
    const children = childrenByParent.get(issue.parentId) ?? [];
    children.push(issue.id);
    childrenByParent.set(issue.parentId, children);
  }

  const selectedIds = new Set<string>();
  const queue = [...normalizedRequested];
  while (queue.length > 0) {
    const issueId = queue.shift();
    if (!issueId || selectedIds.has(issueId)) continue;

    selectedIds.add(issueId);
    const childIds = childrenByParent.get(issueId) ?? [];
    queue.push(...childIds);
  }

  return issues.filter((issue) => selectedIds.has(issue.id));
}

function printBeadsWarnings(warnings: string[]): void {
  const maxWarnings = 20;
  console.log(
    `${colors.yellow}Warnings:${colors.reset} ${warnings.length} encountered during Beads import`,
  );
  const shown = warnings.slice(0, maxWarnings);
  for (const warning of shown) {
    console.log(`  - ${warning}`);
  }
  if (warnings.length > maxWarnings) {
    console.log(`  - ...and ${warnings.length - maxWarnings} more`);
  }
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
        result: subtask.result,
        metadata: subtask.metadata
          ? { ...existing.metadata, ...subtask.metadata }
          : existing.metadata,
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
