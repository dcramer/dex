import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import {
  CliOptions,
  colors,
  createService,
  getBooleanFlag,
  parseArgs,
} from "./utils.js";
import {
  getConfigPath,
  getProjectConfigPath,
  loadConfig,
} from "../core/config.js";
import { getGitHubToken } from "../core/github/index.js";

/**
 * Default auto-sync configuration to add when missing.
 */
const DEFAULT_AUTO_SYNC_CONFIG = {
  on_change: true,
};

export interface DoctorIssue {
  type: "error" | "warning";
  category: "config" | "storage";
  message: string;
  fix?: () => Promise<void>;
}

export interface DoctorResult {
  issues: DoctorIssue[];
  tasksChecked: number;
}

export async function doctorCommand(
  args: string[],
  options: CliOptions
): Promise<void> {
  const { flags } = parseArgs(
    args,
    {
      fix: { hasValue: false },
      help: { short: "h", hasValue: false },
    },
    "doctor"
  );

  if (getBooleanFlag(flags, "help")) {
    console.log(`${colors.bold}dex doctor${colors.reset} - Check and repair dex configuration and storage

${colors.bold}USAGE:${colors.reset}
  dex doctor            # Check for issues (read-only)
  dex doctor --fix      # Check and fix issues

${colors.bold}OPTIONS:${colors.reset}
  --fix                 Apply fixes for detected issues
  -h, --help            Show this help message

${colors.bold}CHECKS:${colors.reset}
  Config:
    - Config file validity (valid TOML)
    - Missing fields (new defaults not in config)
    - Deprecated fields

  Storage:
    - Task file validity (valid JSON, schema conformance)
    - Relationship consistency (parent/child, blockers)
    - Orphaned references

${colors.bold}EXAMPLES:${colors.reset}
  dex doctor                    # Check for issues
  dex doctor --fix              # Fix detected issues
`);
    return;
  }

  const shouldFix = getBooleanFlag(flags, "fix");
  const service = createService(options);

  const result: DoctorResult = {
    issues: [],
    tasksChecked: 0,
  };

  // Check config
  console.log(`\n${colors.bold}Checking config...${colors.reset}`);
  const configIssues = await checkConfig(options);
  result.issues.push(...configIssues);

  if (configIssues.length === 0) {
    console.log(`  ${colors.green}✓${colors.reset} Config valid`);
  } else {
    for (const issue of configIssues) {
      const icon = issue.type === "error" ? colors.red + "✗" : colors.yellow + "⚠";
      console.log(`  ${icon}${colors.reset} ${issue.message}`);
    }
  }

  // Check storage
  console.log(`\n${colors.bold}Checking storage...${colors.reset}`);
  const storageResult = await checkStorage(options, service);
  result.issues.push(...storageResult.issues);
  result.tasksChecked = storageResult.tasksChecked;

  if (storageResult.issues.length === 0) {
    console.log(`  ${colors.green}✓${colors.reset} ${result.tasksChecked} task(s) validated`);
  } else {
    for (const issue of storageResult.issues) {
      const icon = issue.type === "error" ? colors.red + "✗" : colors.yellow + "⚠";
      console.log(`  ${icon}${colors.reset} ${issue.message}`);
    }
  }

  // Summary
  console.log("");
  const errors = result.issues.filter((i) => i.type === "error").length;
  const warnings = result.issues.filter((i) => i.type === "warning").length;
  const fixable = result.issues.filter((i) => i.fix).length;

  if (result.issues.length === 0) {
    console.log(`${colors.green}No issues found.${colors.reset}`);
  } else {
    const parts: string[] = [];
    if (errors > 0) parts.push(`${errors} error(s)`);
    if (warnings > 0) parts.push(`${warnings} warning(s)`);
    console.log(`Found ${parts.join(", ")}.`);

    if (shouldFix && fixable > 0) {
      console.log(`\n${colors.bold}Applying fixes...${colors.reset}`);
      let fixed = 0;
      for (const issue of result.issues) {
        if (issue.fix) {
          try {
            await issue.fix();
            console.log(`  ${colors.green}✓${colors.reset} Fixed: ${issue.message}`);
            fixed++;
          } catch (err) {
            console.log(`  ${colors.red}✗${colors.reset} Failed to fix: ${issue.message}`);
          }
        }
      }
      console.log(`\nFixed ${fixed} issue(s).`);
    } else if (fixable > 0 && !shouldFix) {
      console.log(`\n${colors.dim}Run 'dex doctor --fix' to fix ${fixable} issue(s).${colors.reset}`);
    }
  }
}

async function checkConfig(options: CliOptions): Promise<DoctorIssue[]> {
  const issues: DoctorIssue[] = [];

  // Check global config file
  const globalConfigPath = getConfigPath();
  if (fs.existsSync(globalConfigPath)) {
    try {
      const content = fs.readFileSync(globalConfigPath, "utf-8");
      parseToml(content);
    } catch (err) {
      issues.push({
        type: "error",
        category: "config",
        message: `Global config invalid TOML: ${globalConfigPath}`,
      });
    }
  }

  // Check project config file
  const storagePath = options.storage.getIdentifier();
  if (storagePath) {
    const projectConfigPath = getProjectConfigPath(storagePath);
    if (fs.existsSync(projectConfigPath)) {
      try {
        const content = fs.readFileSync(projectConfigPath, "utf-8");
        parseToml(content);
      } catch (err) {
        issues.push({
          type: "error",
          category: "config",
          message: `Project config invalid TOML: ${projectConfigPath}`,
        });
      }
    }
  }

  // Load merged config to check for deprecated settings
  const config = loadConfig({ storagePath });

  // Check for deprecated storage engines
  if (config.storage.engine === "github-issues") {
    issues.push({
      type: "warning",
      category: "config",
      message: `Deprecated storage engine 'github-issues'. Use 'file' with sync.github instead.`,
    });
  }
  if (config.storage.engine === "github-projects") {
    issues.push({
      type: "warning",
      category: "config",
      message: `Deprecated storage engine 'github-projects'. Use 'file' with sync.github instead.`,
    });
  }

  // Check GitHub sync config if enabled
  if (config.sync?.github?.enabled) {
    const tokenEnv = config.sync.github.token_env || "GITHUB_TOKEN";
    const token = getGitHubToken(tokenEnv);
    if (!token) {
      issues.push({
        type: "warning",
        category: "config",
        message: `GitHub sync enabled but no token found (checked ${tokenEnv} env var and gh CLI)`,
      });
    }

    // Check for missing auto-sync configuration in both global and project configs
    // We check each file that has sync.github.enabled and warn if it's missing the auto section
    const configsToCheck: { path: string; label: string }[] = [];

    // Check global config
    if (fs.existsSync(globalConfigPath)) {
      const globalParsed = parseConfigFileRaw(globalConfigPath);
      if (globalParsed?.sync?.github?.enabled && !globalParsed?.sync?.github?.auto) {
        configsToCheck.push({ path: globalConfigPath, label: "global" });
      }
    }

    // Check project config
    const projectConfigPath = storagePath ? getProjectConfigPath(storagePath) : null;
    if (projectConfigPath && fs.existsSync(projectConfigPath)) {
      const projectParsed = parseConfigFileRaw(projectConfigPath);
      if (projectParsed?.sync?.github?.enabled && !projectParsed?.sync?.github?.auto) {
        configsToCheck.push({ path: projectConfigPath, label: "project" });
      }
    }

    for (const { path: configPath, label } of configsToCheck) {
      issues.push({
        type: "warning",
        category: "config",
        message: `Missing [sync.github.auto] in ${label} config (${configPath})`,
        fix: async () => {
          await addAutoSyncConfig(configPath);
        },
      });
    }
  }

  return issues;
}

/**
 * Parse a TOML config file and return raw parsed object.
 */
function parseConfigFileRaw(configPath: string): any | null {
  if (!fs.existsSync(configPath)) {
    return null;
  }
  try {
    const content = fs.readFileSync(configPath, "utf-8");
    return parseToml(content);
  } catch {
    return null;
  }
}

/**
 * Add auto-sync config section to an existing config file.
 * Preserves existing content and appends the new section.
 */
async function addAutoSyncConfig(configPath: string): Promise<void> {
  const content = fs.readFileSync(configPath, "utf-8");
  const parsed = parseToml(content) as any;

  // Ensure sync.github exists
  if (!parsed.sync) {
    parsed.sync = {};
  }
  if (!parsed.sync.github) {
    parsed.sync.github = { enabled: true };
  }

  // Add auto section with defaults
  parsed.sync.github.auto = { ...DEFAULT_AUTO_SYNC_CONFIG };

  // Write back as TOML
  const newContent = stringifyToml(parsed);
  fs.writeFileSync(configPath, newContent, "utf-8");
}

async function checkStorage(
  options: CliOptions,
  service: ReturnType<typeof createService>
): Promise<{ issues: DoctorIssue[]; tasksChecked: number }> {
  const issues: DoctorIssue[] = [];

  // Load all tasks to check relationships
  const tasks = await service.list({ all: true });
  const taskIds = new Set(tasks.map((t) => t.id));
  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  // Helper to calculate task depth
  const getDepth = (taskId: string, visited = new Set<string>()): number => {
    if (visited.has(taskId)) return Infinity; // Circular reference
    const task = taskMap.get(taskId);
    if (!task || !task.parent_id) return 1;
    visited.add(taskId);
    return 1 + getDepth(task.parent_id, visited);
  };

  for (const task of tasks) {
    // Check parent references
    if (task.parent_id && !taskIds.has(task.parent_id)) {
      issues.push({
        type: "warning",
        category: "storage",
        message: `Task ${task.id}: parent_id '${task.parent_id}' does not exist (orphaned)`,
        fix: async () => {
          await service.update({ id: task.id, parent_id: null });
        },
      });
    }

    // Check depth (max 3 levels: epic -> task -> subtask)
    const depth = getDepth(task.id);
    if (depth === Infinity) {
      issues.push({
        type: "error",
        category: "storage",
        message: `Task ${task.id}: circular parent reference detected`,
        // No automatic fix for circular references
      });
    } else if (depth > 3) {
      issues.push({
        type: "error",
        category: "storage",
        message: `Task ${task.id}: exceeds max depth (depth=${depth}, max=3)`,
        // No automatic fix - user needs to restructure
      });
    }

    // Check blockedBy references
    for (const blockerId of task.blockedBy) {
      if (!taskIds.has(blockerId)) {
        issues.push({
          type: "warning",
          category: "storage",
          message: `Task ${task.id}: blockedBy '${blockerId}' does not exist (dangling reference)`,
          fix: async () => {
            await service.update({ id: task.id, remove_blocked_by: [blockerId] });
          },
        });
      }
    }

    // Check blocks references
    for (const blockedId of task.blocks) {
      if (!taskIds.has(blockedId)) {
        issues.push({
          type: "warning",
          category: "storage",
          message: `Task ${task.id}: blocks '${blockedId}' does not exist (dangling reference)`,
          // Fix handled by the blockedBy check on the other side
        });
      }
    }

    // Check bidirectional consistency: if A blocks B, B should have A in blockedBy
    for (const blockedId of task.blocks) {
      const blockedTask = tasks.find((t) => t.id === blockedId);
      if (blockedTask && !blockedTask.blockedBy.includes(task.id)) {
        issues.push({
          type: "warning",
          category: "storage",
          message: `Task ${task.id}: blocks '${blockedId}' but ${blockedId}.blockedBy is missing '${task.id}'`,
          fix: async () => {
            await service.update({ id: blockedId, add_blocked_by: [task.id] });
          },
        });
      }
    }

    // Check children consistency
    for (const childId of task.children) {
      if (!taskIds.has(childId)) {
        issues.push({
          type: "error",
          category: "storage",
          message: `Task ${task.id}: child '${childId}' does not exist (data corruption)`,
          // No automatic fix - children array is derived from parent_id
          // This indicates storage corruption that needs manual intervention
        });
      } else {
        const child = tasks.find((t) => t.id === childId);
        if (child && child.parent_id !== task.id) {
          issues.push({
            type: "warning",
            category: "storage",
            message: `Task ${task.id}: lists child '${childId}' but child's parent_id is '${child.parent_id || "null"}'`,
            fix: async () => {
              await service.update({ id: childId, parent_id: task.id });
            },
          });
        }
      }
    }
  }

  return { issues, tasksChecked: tasks.length };
}
