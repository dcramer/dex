import {
  CliOptions,
  colors,
  createService,
  formatCliError,
  getBooleanFlag,
  parseArgs,
} from "./utils.js";
import { getGitHubIssueNumber } from "../core/github-sync.js";
import {
  getGitHubRepo,
  parseGitHubIssueRef,
  GitHubRepo,
} from "../core/git-remote.js";
import { loadConfig } from "../core/config.js";
import { parseHierarchicalIssueBody } from "../core/subtask-markdown.js";
import { Task } from "../types.js";
import { Octokit } from "@octokit/rest";

export async function importCommand(
  args: string[],
  options: CliOptions
): Promise<void> {
  const { positional, flags } = parseArgs(
    args,
    {
      all: { hasValue: false },
      "dry-run": { hasValue: false },
      help: { short: "h", hasValue: false },
    },
    "import"
  );

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex import${colors.reset} - Import GitHub Issues as tasks

${colors.bold}USAGE:${colors.reset}
  dex import #123          # Import issue #123 from inferred repo
  dex import <url>         # Import by full URL
  dex import --all         # Import all dex-labeled issues
  dex import --dry-run     # Preview without importing

${colors.bold}ARGUMENTS:${colors.reset}
  <ref>                   Issue reference: #N, URL, or owner/repo#N

${colors.bold}OPTIONS:${colors.reset}
  --all                   Import all issues with dex label
  --dry-run               Show what would be imported without making changes
  -h, --help              Show this help message

${colors.bold}REQUIREMENTS:${colors.reset}
  - Git repository with GitHub remote (for #N syntax)
  - GITHUB_TOKEN environment variable

${colors.bold}EXAMPLE:${colors.reset}
  dex import #42                              # Import issue from current repo
  dex import https://github.com/user/repo/issues/42
  dex import user/repo#42
  dex import --all                            # Import all dex issues
`);
    return;
  }

  const issueRef = positional[0];
  const importAll = getBooleanFlag(flags, "all");
  const dryRun = getBooleanFlag(flags, "dry-run");

  if (!issueRef && !importAll) {
    console.error(
      `${colors.red}Error:${colors.reset} Issue reference or --all required`
    );
    console.error(`Usage: dex import #123 or dex import --all`);
    process.exit(1);
  }

  const config = loadConfig(options.storage.getIdentifier());
  const tokenEnv = config.sync?.github?.token_env || "GITHUB_TOKEN";
  const token = process.env[tokenEnv];

  if (!token) {
    console.error(
      `${colors.red}Error:${colors.reset} GitHub token not found.\n` +
        `Set the ${tokenEnv} environment variable: export ${tokenEnv}=ghp_...`
    );
    process.exit(1);
  }

  const octokit = new Octokit({ auth: token });
  const service = createService(options);
  const labelPrefix = config.sync?.github?.label_prefix || "dex";

  try {
    if (importAll) {
      await importAllIssues(
        octokit,
        service,
        labelPrefix,
        dryRun
      );
    } else {
      await importSingleIssue(
        octokit,
        service,
        issueRef,
        dryRun
      );
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
  dryRun: boolean
): Promise<void> {
  const defaultRepo = getGitHubRepo();
  const parsed = parseGitHubIssueRef(issueRef, defaultRepo ?? undefined);

  if (!parsed) {
    console.error(
      `${colors.red}Error:${colors.reset} Invalid issue reference: ${issueRef}`
    );
    console.error(`Expected: #123, owner/repo#123, or full GitHub URL`);
    process.exit(1);
  }

  // Check if already imported
  const existingTasks = await service.list({ all: true });
  const alreadyImported = existingTasks.find(
    (t) => getGitHubIssueNumber(t) === parsed.number
  );

  if (alreadyImported) {
    console.log(
      `${colors.yellow}Skipped${colors.reset} issue #${parsed.number}: ` +
        `already imported as task ${colors.bold}${alreadyImported.id}${colors.reset}`
    );
    return;
  }

  // Fetch the issue
  const { data: issue } = await octokit.issues.get({
    owner: parsed.owner,
    repo: parsed.repo,
    issue_number: parsed.number,
  });

  if (dryRun) {
    console.log(`Would import from ${colors.cyan}${parsed.owner}/${parsed.repo}${colors.reset}:`);
    console.log(`  #${issue.number}: ${issue.title}`);

    const body = issue.body || "";
    const { subtasks } = parseHierarchicalIssueBody(body);
    if (subtasks.length > 0) {
      console.log(`  (${subtasks.length} subtasks)`);
    }
    return;
  }

  const task = await importIssueAsTask(service, issue, parsed);
  console.log(
    `${colors.green}Imported${colors.reset} issue #${parsed.number} as task ` +
      `${colors.bold}${task.id}${colors.reset}: "${task.description}"`
  );

  // Import subtasks
  const body = issue.body || "";
  const { subtasks } = parseHierarchicalIssueBody(body);

  if (subtasks.length > 0) {
    let subtaskCount = 0;
    for (const subtask of subtasks) {
      // All subtasks are imported under the root task
      // (parentId from the issue refers to original IDs which don't exist locally)
      await service.create({
        description: subtask.description,
        context: subtask.context || "Imported from GitHub issue",
        parent_id: task.id,
        priority: subtask.priority,
      });
      subtaskCount++;
    }
    console.log(`  Created ${subtaskCount} subtask(s)`);
  }
}

async function importAllIssues(
  octokit: Octokit,
  service: ReturnType<typeof createService>,
  labelPrefix: string,
  dryRun: boolean
): Promise<void> {
  const repo = getGitHubRepo();
  if (!repo) {
    console.error(
      `${colors.red}Error:${colors.reset} Cannot determine GitHub repository.\n` +
        `This directory is not in a git repository with a GitHub remote.`
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
    console.log(`No issues with "${labelPrefix}" label found in ${repo.owner}/${repo.repo}.`);
    return;
  }

  // Get existing tasks to check for duplicates
  const existingTasks = await service.list({ all: true });
  const importedNumbers = new Set(
    existingTasks
      .map(getGitHubIssueNumber)
      .filter((n): n is number => n !== null)
  );

  const toImport = realIssues.filter((i) => !importedNumbers.has(i.number));
  const skipped = realIssues.length - toImport.length;

  if (dryRun) {
    console.log(
      `Would import ${toImport.length} issue(s) from ${colors.cyan}${repo.owner}/${repo.repo}${colors.reset}:`
    );
    for (const issue of toImport) {
      console.log(`  #${issue.number}: ${issue.title}`);
    }
    if (skipped > 0) {
      console.log(`  (${skipped} already imported)`);
    }
    return;
  }

  let imported = 0;
  for (const issue of toImport) {
    const task = await importIssueAsTask(service, issue, repo);
    console.log(
      `${colors.green}Imported${colors.reset} #${issue.number} as ${colors.bold}${task.id}${colors.reset}`
    );
    imported++;
  }

  console.log(
    `\nImported ${imported} issue(s) from ${colors.cyan}${repo.owner}/${repo.repo}${colors.reset}`
  );
  if (skipped > 0) {
    console.log(`Skipped ${skipped} already imported`);
  }
}

async function importIssueAsTask(
  service: ReturnType<typeof createService>,
  issue: { number: number; title: string; body?: string | null; state: string },
  repo: GitHubRepo
): Promise<Task> {
  const body = issue.body || "";

  // Parse the issue body
  const { context } = parseHierarchicalIssueBody(body);

  // Strip the dex task comment if present
  const cleanContext = context
    .replace(/<!-- dex:task:.*? -->\n?/, "")
    .trim();

  const task = await service.create({
    description: issue.title,
    context: cleanContext || `Imported from GitHub issue #${issue.number}`,
  });

  // Update with proper github metadata (matching sync format) and completion status
  const repoString = `${repo.owner}/${repo.repo}`;
  const githubMetadata = {
    ...task.metadata,
    github: {
      issueNumber: issue.number,
      issueUrl: `https://github.com/${repoString}/issues/${issue.number}`,
      repo: repoString,
    },
  };

  return await service.update({
    id: task.id,
    metadata: githubMetadata,
    ...(issue.state === "closed" && {
      completed: true,
      result: "Imported as completed from GitHub",
    }),
  });
}

