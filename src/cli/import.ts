import { CliOptions, createService, formatCliError } from "./utils.js";
import { colors } from "./colors.js";
import { getBooleanFlag, parseArgs } from "./args.js";
import {
  getGitHubIssueNumber,
  getGitHubRepo,
  parseGitHubIssueRef,
  GitHubRepo,
  parseHierarchicalIssueBody,
  parseRootTaskMetadata,
  getGitHubToken,
} from "../core/github/index.js";
import { loadConfig } from "../core/config.js";
import { Task } from "../types.js";
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
      help: { short: "h", hasValue: false },
    },
    "import",
  );

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex import${colors.reset} - Import GitHub Issues as tasks

${colors.bold}USAGE:${colors.reset}
  dex import #123          # Import issue #123 from inferred repo
  dex import <url>         # Import by full URL
  dex import --all         # Import all dex-labeled issues
  dex import --dry-run     # Preview without importing
  dex import #123 --update # Update existing task from GitHub

${colors.bold}ARGUMENTS:${colors.reset}
  <ref>                   Issue reference: #N, URL, or owner/repo#N

${colors.bold}OPTIONS:${colors.reset}
  --all                   Import all issues with dex label
  --update                Update existing task if already imported
  --dry-run               Show what would be imported without making changes
  -h, --help              Show this help message

${colors.bold}REQUIREMENTS:${colors.reset}
  - Git repository with GitHub remote (for #N syntax)
  - GitHub authentication (GITHUB_TOKEN env var or 'gh auth login')

${colors.bold}EXAMPLE:${colors.reset}
  dex import #42                              # Import issue from current repo
  dex import https://github.com/user/repo/issues/42
  dex import user/repo#42
  dex import --all                            # Import all dex issues
  dex import #42 --update                     # Refresh local task from GitHub
`);
    return;
  }

  const issueRef = positional[0];
  const importAll = getBooleanFlag(flags, "all");
  const dryRun = getBooleanFlag(flags, "dry-run");
  const update = getBooleanFlag(flags, "update");

  if (!issueRef && !importAll) {
    console.error(
      `${colors.red}Error:${colors.reset} Issue reference or --all required`,
    );
    console.error(`Usage: dex import #123 or dex import --all`);
    process.exit(1);
  }

  const config = loadConfig({ storagePath: options.storage.getIdentifier() });
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
  const service = createService(options);
  const labelPrefix = config.sync?.github?.label_prefix || "dex";

  try {
    if (importAll) {
      await importAllIssues(octokit, service, labelPrefix, dryRun, update);
    } else {
      await importSingleIssue(octokit, service, issueRef, dryRun, update);
    }
  } catch (err) {
    console.error(formatCliError(err));
    process.exit(1);
  }
}

async function importSingleIssue(
  octokit: Octokit,
  service: ReturnType<typeof createService>,
  issueRef: string,
  dryRun: boolean,
  update: boolean,
): Promise<void> {
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
            `from issue #${parsed.number}`,
        );
        return;
      }

      const updatedTask = await updateTaskFromIssue(
        service,
        alreadyImported,
        issue,
        parsed,
      );
      console.log(
        `${colors.green}Updated${colors.reset} task ${colors.bold}${updatedTask.id}${colors.reset} ` +
          `from issue #${parsed.number}`,
      );
      return;
    }

    console.log(
      `${colors.yellow}Skipped${colors.reset} issue #${parsed.number}: ` +
        `already imported as task ${colors.bold}${alreadyImported.id}${colors.reset}\n` +
        `  Use --update to refresh from GitHub`,
    );
    return;
  }

  const body = issue.body || "";
  const { subtasks } = parseHierarchicalIssueBody(body);

  if (dryRun) {
    console.log(
      `Would import from ${colors.cyan}${parsed.owner}/${parsed.repo}${colors.reset}:`,
    );
    console.log(`  #${issue.number}: ${issue.title}`);
    if (subtasks.length > 0) {
      console.log(`  (${subtasks.length} subtasks)`);
    }
    return;
  }

  const task = await importIssueAsTask(service, issue, parsed);
  console.log(
    `${colors.green}Imported${colors.reset} issue #${parsed.number} as task ` +
      `${colors.bold}${task.id}${colors.reset}: "${task.name}"`,
  );

  if (subtasks.length > 0) {
    // Track ID mapping: original ID -> local ID (for hierarchy reconstruction)
    const idMapping = new Map<string, string>();

    for (const subtask of subtasks) {
      const localParentId = subtask.parentId
        ? idMapping.get(subtask.parentId) || task.id
        : task.id;

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
        completed_at: subtask.completed_at,
        metadata: subtask.metadata,
      });

      idMapping.set(subtask.id, createdSubtask.id);
    }
    console.log(`  Created ${idMapping.size} subtask(s)`);
  }
}

async function importAllIssues(
  octokit: Octokit,
  service: ReturnType<typeof createService>,
  labelPrefix: string,
  dryRun: boolean,
  update: boolean,
): Promise<void> {
  const repo = getGitHubRepo();
  if (!repo) {
    console.error(
      `${colors.red}Error:${colors.reset} Cannot determine GitHub repository.\n` +
        `This directory is not in a git repository with a GitHub remote.`,
    );
    process.exit(1);
  }

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
      `No issues with "${labelPrefix}" label found in ${repo.owner}/${repo.repo}.`,
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
        `Would import ${toImport.length} issue(s) from ${colors.cyan}${repo.owner}/${repo.repo}${colors.reset}:`,
      );
      for (const issue of toImport) {
        console.log(`  #${issue.number}: ${issue.title}`);
      }
    }
    if (toUpdate.length > 0) {
      console.log(
        `Would update ${toUpdate.length} task(s) from ${colors.cyan}${repo.owner}/${repo.repo}${colors.reset}:`,
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
    const task = await importIssueAsTask(service, issue, repo);
    console.log(
      `${colors.green}Imported${colors.reset} #${issue.number} as ${colors.bold}${task.id}${colors.reset}`,
    );
    imported++;
  }

  for (const issue of toUpdate) {
    const existingTask = importedByNumber.get(issue.number)!;
    await updateTaskFromIssue(service, existingTask, issue, repo);
    console.log(
      `${colors.green}Updated${colors.reset} #${issue.number} → ${colors.bold}${existingTask.id}${colors.reset}`,
    );
    updated++;
  }

  console.log(
    `\nImported ${imported}, updated ${updated} issue(s) from ${colors.cyan}${repo.owner}/${repo.repo}${colors.reset}`,
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

interface ParsedIssueData {
  cleanContext: string;
  rootMetadata: ReturnType<typeof parseRootTaskMetadata>;
  githubMetadata: {
    issueNumber: number;
    issueUrl: string;
    repo: string;
  };
}

function parseIssueData(issue: GitHubIssue, repo: GitHubRepo): ParsedIssueData {
  const body = issue.body || "";
  const { description } = parseHierarchicalIssueBody(body);

  // Remove dex:task: comments (both new format dex:task:key:value and legacy dex:task:id)
  const cleanContext = description
    .replace(/<!-- dex:task:[^\s]+ -->\n?/g, "")
    .trim();

  const rootMetadata = parseRootTaskMetadata(body);
  const repoString = `${repo.owner}/${repo.repo}`;

  return {
    cleanContext,
    rootMetadata,
    githubMetadata: {
      issueNumber: issue.number,
      issueUrl: `https://github.com/${repoString}/issues/${issue.number}`,
      repo: repoString,
    },
  };
}

async function importIssueAsTask(
  service: ReturnType<typeof createService>,
  issue: GitHubIssue,
  repo: GitHubRepo,
): Promise<Task> {
  const { cleanContext, rootMetadata, githubMetadata } = parseIssueData(
    issue,
    repo,
  );

  // Determine completion status: prefer metadata, fall back to issue state
  const completed = rootMetadata?.completed ?? issue.state === "closed";

  const metadata = {
    github: githubMetadata,
    commit: rootMetadata?.commit,
  };

  return await service.create({
    id: rootMetadata?.id, // Use original ID if available (will fail if conflict)
    name: issue.title,
    description: cleanContext || `Imported from GitHub issue #${issue.number}`,
    priority: rootMetadata?.priority,
    completed,
    result:
      rootMetadata?.result ??
      (completed ? "Imported as completed from GitHub" : null),
    metadata,
    created_at: rootMetadata?.created_at,
    updated_at: rootMetadata?.updated_at,
    completed_at: rootMetadata?.completed_at,
  });
}

async function updateTaskFromIssue(
  service: ReturnType<typeof createService>,
  existingTask: Task,
  issue: GitHubIssue,
  repo: GitHubRepo,
): Promise<Task> {
  const { cleanContext, rootMetadata, githubMetadata } = parseIssueData(
    issue,
    repo,
  );

  const isClosed = issue.state === "closed";

  return await service.update({
    id: existingTask.id,
    name: issue.title,
    description: cleanContext || existingTask.description,
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
